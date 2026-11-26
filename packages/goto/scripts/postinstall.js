'use strict'

const {
  PuppeteerBlocker,
  fetchLists,
  fetchResources,
  fullLists
} = require('@ghostery/adblocker-puppeteer')
const { promisify } = require('util')
const got = require('@kikobeats/got')
const fs = require('fs')

const { HAGEZI_MULTI_PRO_URL, toThirdPartyRules } = require('./hagezi')

const writeFile = promisify(fs.writeFile)

const OUTPUT_FILENAME = 'src/engine.bin'

const DOWNLOAD_TIMEOUT = 60000

const download = url => got(url, { timeout: DOWNLOAD_TIMEOUT })

// Lightweight `fetch` polyfill on top of `got` to allow consumption by adblocker
const fetch = url =>
  Promise.resolve({
    text: () => download(url).text(),
    arrayBuffer: () => download(url).buffer(),
    json: () => download(url).json()
  })

const main = async () => {
  const [lists, hageziList, resources] = await Promise.all([
    fetchLists(fetch, fullLists),
    download(HAGEZI_MULTI_PRO_URL).text(),
    fetchResources(fetch)
  ])
  const engine = PuppeteerBlocker.parse([...lists, ...toThirdPartyRules(hageziList)].join('\n'))
  engine.updateResources(resources, String(resources.length))
  await writeFile(OUTPUT_FILENAME, engine.serialize())
}

main().catch(error => console.error(error) || process.exit(1))
