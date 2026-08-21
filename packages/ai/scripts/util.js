'use strict'

const { pipeline } = require('node:stream/promises')
const { createHmac, createHash } = require('node:crypto')
const { Readable, Transform } = require('node:stream')
const { createReadStream, createWriteStream, mkdirSync, statSync } = require('node:fs')
const path = require('node:path')

const UNSIGNED = 'UNSIGNED-PAYLOAD'
const PART_SIZE = 16 * 1024 * 1024
const DEFAULT_KEY = 'browserless-ai-nano.zip'

const encodeRfc3986 = value =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )

const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest()
const sha256Hex = data => createHash('sha256').update(data).digest('hex')
const amzNow = () => new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
const signingKey = (secret, date, region) =>
  hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 's3'), 'aws4_request')

const parseS3Url = value => {
  if (!value) return {}
  try {
    const url = new URL(value)
    const parts = url.pathname.split('/').filter(Boolean)
    return {
      endpoint: url.origin,
      bucket: parts[0],
      key: parts.slice(1).join('/')
    }
  } catch {
    return {}
  }
}

const credentials = () => {
  const fromEnv = parseS3Url(process.env.R2_ENDPOINT)
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID
  return {
    bucket: process.env.R2_BUCKET || fromEnv.bucket,
    key: process.env.R2_KEY || fromEnv.key || DEFAULT_KEY,
    accessKey: process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    endpoint:
      fromEnv.endpoint ||
      process.env.R2_ENDPOINT ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined),
    region: process.env.R2_REGION || 'auto'
  }
}

const objectUrl = opts => `${opts.endpoint}/${opts.bucket}/${opts.key}`

const objectPath = (bucket, key) =>
  `/${encodeRfc3986(bucket)}/${key.split('/').map(encodeRfc3986).join('/')}`

const canonicalQuery = query =>
  Object.keys(query)
    .sort()
    .map(
      name =>
        `${encodeRfc3986(name)}=${query[name] === '' ? '' : encodeRfc3986(String(query[name]))}`
    )
    .join('&')

const sign = ({
  method,
  endpoint,
  pathname,
  query = {},
  extraHeaders = {},
  accessKey,
  secretKey,
  region
}) => {
  const amzDate = amzNow()
  const date = amzDate.slice(0, 8)
  const host = new URL(endpoint).host
  const headers = {
    host,
    'x-amz-content-sha256': UNSIGNED,
    'x-amz-date': amzDate,
    ...extraHeaders
  }
  const names = Object.keys(headers)
    .map(name => name.toLowerCase())
    .sort()
  const headerMap = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()])
  )
  const canonicalHeaders = names.map(name => `${name}:${headerMap[name]}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalRequest = [
    method,
    pathname,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    UNSIGNED
  ].join('\n')
  const scope = `${date}/${region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', signingKey(secretKey, date, region))
    .update(stringToSign)
    .digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return headers
}

const signedFetch = async (
  opts,
  { method, query = {}, body, contentLength, contentType, signal }
) => {
  const pathname = objectPath(opts.bucket, opts.key)
  const extraHeaders = {}
  if (contentLength != null) extraHeaders['content-length'] = String(contentLength)
  if (contentType) extraHeaders['content-type'] = contentType
  const headers = sign({
    method,
    endpoint: opts.endpoint,
    pathname,
    query,
    extraHeaders,
    accessKey: opts.accessKey,
    secretKey: opts.secretKey,
    region: opts.region || 'auto'
  })
  const search = canonicalQuery(query)
  const url = `${opts.endpoint}${pathname}${search ? `?${search}` : ''}`
  return fetch(url, {
    method,
    headers,
    body,
    signal,
    duplex: body && typeof body !== 'string' ? 'half' : undefined
  })
}

const request = async (opts, init) => {
  const res = await signedFetch(opts, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`R2 ${init.method} ${res.status}: ${text.slice(0, 500)}`)
  return { headers: res.headers, text }
}

const xmlText = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))
  if (!match) throw new Error(`missing <${tag}> in R2 response`)
  return match[1]
}

const prettyBytes = n => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`
  return `${n} B`
}

const createReporter = label => {
  const interactive = process.stderr.isTTY && !process.env.CI
  let last = 0
  return (loaded, total, done = false) => {
    const now = Date.now()
    if (!done && now - last < (interactive ? 200 : 5000)) return
    last = now
    const pct = total ? Math.min(100, Math.floor((loaded / total) * 100)) : 0
    const line = `${label} ${prettyBytes(loaded)}/${prettyBytes(total)} ${pct}%`
    process.stderr.write(interactive ? `\r${line}` : `${line}\n`)
    if (done && interactive) process.stderr.write('\n')
  }
}

const toNodeStream = body => {
  if (!body) throw new Error('empty S3 body')
  if (typeof body.pipe === 'function') return body
  if (typeof body.getReader === 'function') return Readable.fromWeb(body)
  return Readable.from(body)
}

const DOWNLOAD_TIMEOUT = 15 * 60 * 1000

const downloadFile = async (opts, dest) => {
  const res = await signedFetch(opts, {
    method: 'GET',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`R2 GET ${res.status}: ${text.slice(0, 500)}`)
  }
  const total = Number(res.headers.get('content-length')) || 0
  const report = createReporter('downloading')
  let loaded = 0
  mkdirSync(path.dirname(dest), { recursive: true })
  await pipeline(
    toNodeStream(res.body),
    new Transform({
      transform (chunk, _enc, cb) {
        loaded += chunk.length
        report(loaded, total)
        cb(null, chunk)
      }
    }),
    createWriteStream(dest)
  )
  report(loaded, total, true)
}

const uploadFile = async (opts, file) => {
  const { size } = statSync(file)
  const report = createReporter('uploading')
  if (size <= PART_SIZE) {
    report(0, size)
    await request(opts, {
      method: 'PUT',
      body: createReadStream(file),
      contentLength: size,
      contentType: 'application/zip'
    })
    report(size, size, true)
    return
  }

  const created = await request(opts, {
    method: 'POST',
    query: { uploads: '' },
    contentType: 'application/zip'
  })
  const uploadId = xmlText(created.text, 'UploadId')
  const parts = []
  try {
    let partNumber = 1
    for (let start = 0; start < size; start += PART_SIZE, partNumber++) {
      const end = Math.min(start + PART_SIZE, size) - 1
      const length = end - start + 1
      report(start, size)
      const { headers } = await request(opts, {
        method: 'PUT',
        query: { partNumber, uploadId },
        body: createReadStream(file, { start, end }),
        contentLength: length
      })
      const etag = headers.get('etag')
      if (!etag) throw new Error(`part ${partNumber} missing ETag`)
      parts.push({ partNumber, etag })
      report(end + 1, size)
    }
    report(size, size, true)
    const body =
      '<CompleteMultipartUpload>' +
      parts
        .map(
          part =>
            `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`
        )
        .join('') +
      '</CompleteMultipartUpload>'
    await request(opts, {
      method: 'POST',
      query: { uploadId },
      body,
      contentLength: Buffer.byteLength(body),
      contentType: 'application/xml'
    })
  } catch (error) {
    await request(opts, { method: 'DELETE', query: { uploadId } }).catch(() => {})
    throw error
  }
}

module.exports = { credentials, downloadFile, objectUrl, uploadFile }
