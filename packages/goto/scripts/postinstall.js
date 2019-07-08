'use strict'

const { PuppeteerBlocker, getLinesWithFilters } = require('@cliqz/adblocker')
const { promisify } = require('util')
const { EOL } = require('os')
const got = require('got')
const fs = require('fs')

const writeFile = promisify(fs.writeFile)

// uBlock Origin –  https://github.com/uBlockOrigin/uAssets/tree/master/filters
const RESOURCES =
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/resources.txt'

const FILTERS = [
  // uBlock Origin –  https://github.com/uBlockOrigin/uAssets/tree/master/filters
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/resource-abuse.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',

  // Fanboy – https://www.fanboy.co.nz
  // Easylist, Easyprivacy, Enhanced Trackers
  'https://www.fanboy.co.nz/r/fanboy-complete.txt',
  // Fanboy Annoyances List + Fanboy-Social List
  'https://easylist-downloads.adblockplus.org/fanboy-annoyance.txt',
  // Other
  // Cookies Lists
  'https://www.fanboy.co.nz/fanboy-cookiemonster.txt',
  // crypto miners
  'https://raw.githubusercontent.com/hoshsadiq/adblock-nocoin-list/master/nocoin.txt',
  // Hosts
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts'
]

const rulesFromURL = async url => {
  const { body } = await got(url)
  return body
}

const main = async urls => {
  const rules = Array.from(
    getLinesWithFilters((await Promise.all(urls.map(rulesFromURL))).join(EOL))
  )
  const engine = PuppeteerBlocker.parse(rules.join(EOL))
  engine.updateResources(await rulesFromURL(RESOURCES), '' + Date.now())
  await writeFile('src/engine.bin', engine.serialize())
}

main(FILTERS)
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .then(process.exit)
