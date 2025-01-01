'use strict'

const { PuppeteerBlocker } = require('@ghostery/adblocker-puppeteer')
const { promisify } = require('util')
const got = require('got')
const fs = require('fs')

const writeFile = promisify(fs.writeFile)

const OUTPUT_FILENAME = 'src/engine.bin'

// Lightweight `fetch` polyfill on top of `got` to allow consumption by adblocker
const fetch = url =>
  Promise.resolve({
    text: () => got(url).text(),
    arrayBuffer: () => got(url).buffer(),
    json: () => got(url).json()
  })

const main = async () => {
  // create a ad-blocker engine
  const engine = await PuppeteerBlocker.fromPrebuiltFull(fetch)
  await writeFile(OUTPUT_FILENAME, engine.serialize())
}

main().catch(error => console.error(error) || process.exit(1))
