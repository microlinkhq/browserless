'use strict'

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const { fetch } = require('../../scripts/postinstall')

const req = createRequire(require.resolve('@ghostery/adblocker-puppeteer'))
const dts = path.join(path.dirname(req.resolve('@ghostery/adblocker')), 'fetch.d.ts')
const src = fs.readFileSync(dts, 'utf8')
const start = src.indexOf('interface FetchResponse')
const body = src.slice(start, src.indexOf('}', start))
const names = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map(match => match[1])

if (!names.length) throw new Error('FetchResponse declares no methods')

fetch('https://example.invalid/list.txt')
  .then(async response => {
    const seen = []
    for (const name of names) {
      if (typeof response[name] !== 'function') throw new Error('missing ' + name)
      const value = await response[name]()
      seen.push(`${name}:${value === null || value === undefined ? String(value) : typeof value}`)
    }
    console.log(seen.join(','))
  })
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
