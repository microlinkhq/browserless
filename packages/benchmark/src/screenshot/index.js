'use strict'

const prettyMs = require('pretty-ms')
const timeSpan = require('time-span')
const termImg = require('term-img')

const printImage = image => termImg(image, { width: '50%' })

const URLS = [
  'https://example.com',
  'https://vercel.com',
  'https://backendlessconf.com',
  'https://static.fun/',
  'https://static-fun-7fhcrqaql.now.sh/',
  'https://polymer.now-examples.now.sh/',
  'https://stencil.now-examples.now.sh/',
  'https://testnow-dufar18r5.now.sh'
]

const createBrowserless = require('browserless')

const main = async () => {
  const browserless = await createBrowserless()
  const total = timeSpan()

  for (const url of URLS) {
    const time = timeSpan()
    const buffer = await browserless.screenshot(url)
    console.log(`\n# ${url} ${prettyMs(time())}\n`)
    console.log(printImage(buffer))
    console.log()
  }

  console.log(`\n${prettyMs(total())}\n`)

  await browserless.close()
}

main()
  .then(() => process.exit())
  .catch(() => process.exit(1))
