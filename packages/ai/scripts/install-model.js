'use strict'

const createAi = require('..')
const { credentials } = require('./util')

const main = async () => {
  const env = credentials()
  if (!env.endpoint || !env.bucket || !env.accessKey || !env.secretKey) {
    if (process.env.CI) process.stderr.write('skip model download: missing R2 credentials\n')
    return
  }
  const { dir } = await createAi.unpack(createAi.download)
  process.stdout.write(`${dir}\n`)
}

main().catch(error => {
  console.error(error.message || error)
  process.exit(1)
})
