'use strict'

const { parseFilters } = require('@cliqz/adblocker')
const { promisify } = require('util')
const { EOL } = require('os')
const got = require('got')
const fs = require('fs')

const writeFile = promisify(fs.writeFile)

const FILTERS = [
  // uBlock Origin –  https://github.com/uBlockOrigin/uAssets/tree/master/filters
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/resource-abuse.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt',

  // Easylist – https://easylist.to/
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://easylist.to/easylist/fanboy-annoyance.txt',
  'https://easylist.to/easylist/fanboy-social.txt',

  // Other
  'http://pgl.yoyo.org/as/serverlist.php?hostformat=adblockplus;showintro=0&mimetype=plaintext',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/recipes/recipes_en.txt',
  'https://www.i-dont-care-about-cookies.eu/abp/',
  'https://raw.githubusercontent.com/liamja/Prebake/master/obtrusive.txt'
]

const rulesFromURL = async url => {
  const { body } = await got(url)
  return body
}

const rulesFromURLs = async urls => {
  const lists = await Promise.all(urls.map(rulesFromURL))

  // Parse all lists
  const { networkFilters, cosmeticFilters } = parseFilters(lists.join(EOL), {
    debug: true
  })

  // Return cleaned version of the lists (no comments, no spaces, etc.)
  return [
    ...new Set([...networkFilters.map(f => f.rawLine), ...cosmeticFilters.map(f => f.rawLine)])
  ]
}

const toTxt = (filepath, data) => writeFile(filepath, data)

const main = async urls => {
  const rules = await rulesFromURLs(urls)
  await toTxt('src/rules.txt', rules.join(EOL))
}

main(FILTERS)
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .then(process.exit)
