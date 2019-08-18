'use strict'

const { PuppeteerBlocker, fullLists } = require('@cliqz/adblocker-puppeteer')
const { promisify } = require('util')
const got = require('got')
const fs = require('fs')

const writeFile = promisify(fs.writeFile)

const OUTPUT_FILENAME = 'src/engine.bin'

// Lightweight `fetch` polyfill on top of `got` to allow consumption by adblocker
const fetch = async url => {
  const body = (await got(url)).body

  return {
    text: () => body,
    arrayBuffer: () => Buffer.from(body, 'ascii').buffer,
    json: () => JSON.parse(body)
  }
}

const main = async () => {
  // create a ad-blocker engine
  const engine = await PuppeteerBlocker.fromLists(fetch, fullLists)
  await writeFile(OUTPUT_FILENAME, engine.serialize())
}

main()
  .catch(err => console.error(err) && process.exit(1))
  .then(process.exit)
