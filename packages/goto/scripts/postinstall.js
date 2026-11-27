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

const buildEngine = async fetchImpl => {
  const [lists, hageziList, resources] = await Promise.all([
    fetchLists(fetchImpl, fullLists),
    fetchImpl(HAGEZI_MULTI_PRO_URL).then(response => response.text()),
    fetchResources(fetchImpl)
  ])
  const engine = PuppeteerBlocker.parse([...lists, ...toThirdPartyRules(hageziList)].join('\n'))
  engine.updateResources(resources, String(resources.length))
  return engine
}

const main = async () => {
  await writeFile(OUTPUT_FILENAME, (await buildEngine(fetch)).serialize())
}

module.exports = { buildEngine, fetch }

if (require.main === module) {
  main().catch(error => console.error(error) || process.exit(1))
}
