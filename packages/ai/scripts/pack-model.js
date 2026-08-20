'use strict'

const { crc32 } = require('node:zlib')
const path = require('node:path')
const os = require('node:os')

const { createReadStream, createWriteStream, existsSync, statSync } = require('node:fs')

const { hasFile } = require('../src/find-dir')
const { credentials, objectUrl, uploadFile } = require('./util')

const ZIP32_MAX = 0xffffffff

const chromeSupport = (...parts) =>
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', ...parts)
    : undefined

const parseArgs = argv => {
  const extra = argv.slice(2).filter(flag => flag !== '--upload')
  if (extra.length) throw new Error('usage: pack-model.js [--upload]')
  const dir = process.env.BROWSERLESS_AI_DIR
  const model = process.env.BROWSERLESS_AI_MODEL || dir || chromeSupport('OptGuideOnDeviceModel')
  const adaptation =
    process.env.BROWSERLESS_AI_ADAPTATION || dir || chromeSupport('optimization_guide_model_store')
  if (!model) throw new Error('set BROWSERLESS_AI_DIR or BROWSERLESS_AI_MODEL')
  if (!adaptation) throw new Error('set BROWSERLESS_AI_DIR or BROWSERLESS_AI_ADAPTATION')
  return {
    model,
    adaptation,
    out: path.join(os.tmpdir(), 'browserless-ai-nano.zip'),
    upload: argv.includes('--upload')
  }
}

const ADAPTATIONS = [
  { name: 'prompt', target: 49 },
  { name: 'summarize', target: 51 },
  { name: 'detect', target: 2 }
]

const resolveModelDir = root => {
  const dir = hasFile(root, 'weights.bin')
  if (!dir) throw new Error(`No weights.bin under ${root}`)
  for (const name of ['weights.bin', 'manifest.json', 'on_device_model_execution_config.pb']) {
    if (!existsSync(path.join(dir, name))) throw new Error(`Missing ${name} in ${dir}`)
  }
  return dir
}

const resolveFeatureDir = (root, { name, target }) =>
  hasFile(path.join(root, name), 'model-info.pb') ||
  hasFile(path.join(root, String(target)), 'model-info.pb')

const crcAndSize = async file => {
  const { size } = statSync(file)
  if (size > ZIP32_MAX) throw new Error(`${file} is too large for ZIP32`)
  let crc = 0
  for await (const chunk of createReadStream(file)) crc = crc32(chunk, crc)
  return { size, crc }
}

const localHeader = (name, { size, crc }) => {
  const nameBuf = Buffer.from(name)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(size, 18)
  header.writeUInt32LE(size, 22)
  header.writeUInt16LE(nameBuf.length, 26)
  return Buffer.concat([header, nameBuf])
}

const centralHeader = (name, { size, crc, offset }) => {
  const nameBuf = Buffer.from(name)
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(size, 20)
  header.writeUInt32LE(size, 24)
  header.writeUInt16LE(nameBuf.length, 28)
  header.writeUInt32LE(offset, 42)
  return Buffer.concat([header, nameBuf])
}

const write = (stream, buf) =>
  new Promise((resolve, reject) => {
    stream.write(buf, err => (err ? reject(err) : resolve()))
  })

const writeZip = async (dest, entries) => {
  const out = createWriteStream(dest)
  const centrals = []
  let offset = 0

  for (const { name, file } of entries) {
    process.stderr.write(`packing ${name}\n`)
    const info = await crcAndSize(file)
    const header = localHeader(name, info)
    if (offset + header.length + info.size > ZIP32_MAX) {
      throw new Error('archive exceeds ZIP32 size')
    }
    await write(out, header)
    for await (const chunk of createReadStream(file)) await write(out, chunk)
    centrals.push({ name, ...info, offset })
    offset += header.length + info.size
  }

  let centralSize = 0
  for (const entry of centrals) {
    const header = centralHeader(entry.name, entry)
    await write(out, header)
    centralSize += header.length
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(centrals.length, 8)
  end.writeUInt16LE(centrals.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  await write(out, end)

  await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())))
}

const main = async () => {
  const opts = parseArgs(process.argv)
  const modelDir = resolveModelDir(opts.model)
  const version = path.basename(modelDir)
  const entries = [
    { name: `nano/${version}/weights.bin`, file: path.join(modelDir, 'weights.bin') },
    { name: `nano/${version}/manifest.json`, file: path.join(modelDir, 'manifest.json') },
    {
      name: `nano/${version}/on_device_model_execution_config.pb`,
      file: path.join(modelDir, 'on_device_model_execution_config.pb')
    }
  ]

  let packed = 0
  for (const feature of ADAPTATIONS) {
    const dir = resolveFeatureDir(opts.adaptation, feature)
    if (!dir) continue
    packed++
    for (const name of ['model.tflite', 'model-info.pb', 'on_device_model_execution_config.pb']) {
      const file = path.join(dir, name)
      if (existsSync(file)) entries.push({ name: `${feature.name}/${name}`, file })
    }
  }
  if (!packed) throw new Error(`No prompt/summarize/detect adaptations under ${opts.adaptation}`)

  await writeZip(opts.out, entries)
  console.log(opts.out)
  if (!opts.upload) return

  const env = credentials()
  if (!env.endpoint) throw new Error('set R2_ENDPOINT or R2_ACCOUNT_ID')
  if (!env.bucket) throw new Error('set R2_BUCKET, or include the bucket in R2_ENDPOINT')
  if (!env.accessKey || !env.secretKey) {
    throw new Error('set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY')
  }
  await uploadFile(env, opts.out)
  console.log(objectUrl(env))
}

main().catch(error => {
  console.error(error.message || error)
  process.exit(1)
})
