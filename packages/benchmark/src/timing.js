'use strict'

const puppeteer = require('puppeteer')
const timeSpan = require('time-span')
const prettyMs = require('pretty-ms')
const { forEach, orderBy } = require('lodash')

const results = []
;(async () => {
  console.log('Creating browser...')
  const browserTime = timeSpan()
  const browser = await puppeteer.launch()
  browserTime()
  results.push({ key: 'puppeteer.launch', value: browserTime() })

  console.log('Creating page...')
  const pageTime = timeSpan()
  const page = await browser.newPage()
  pageTime()
  results.push({ key: 'browser.newPage', value: pageTime() })

  console.log('Going to URL...')
  const urlTime = timeSpan()
  await page.goto('https://kikobeats.com')
  urlTime()
  results.push({ key: 'page.goto', value: urlTime() })

  console.log('Getting content...')
  const contentTime = timeSpan()
  await page.content()
  contentTime()
  results.push({ key: 'page.content', value: contentTime() })

  console.log('Closing content...')
  const pageCloseTime = timeSpan()
  await page.close()
  pageCloseTime()
  results.push({ key: 'page.close', value: pageCloseTime() })

  console.log('Closing browser...')
  const browserCloseTime = timeSpan()
  await browser.close()
  browserCloseTime()
  results.push({ key: 'browser.close', value: browserCloseTime() })

  const timings = orderBy(results, ['value'], ['desc'])

  console.log()
  forEach(timings, ({ value, key }) => {
    console.log(`${key}: ${prettyMs(value)}`)
  })
})()
