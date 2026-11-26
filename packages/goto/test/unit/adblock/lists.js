'use strict'

const { default: test } = require('ava')
const { PuppeteerBlocker, Request } = require('@ghostery/adblocker-puppeteer')

const { toThirdPartyRules } = require('../../../scripts/hagezi')

const HAGEZI_LIST = [
  '[Adblock Plus]',
  '! Title: HaGeZi fixture',
  '||tracker.example^',
  '  ||telemetry.vendor.example^  ',
  ''
].join('\n')

const engine = PuppeteerBlocker.parse(toThirdPartyRules(HAGEZI_LIST).join('\n'))

const isBlocked = (url, sourceUrl, type = 'script') =>
  engine.match(Request.fromRawDetails({ url, type, sourceUrl })).match

test('keeps only domain rules and scopes them to third party requests', t => {
  t.deepEqual(toThirdPartyRules(HAGEZI_LIST), [
    '||tracker.example^$third-party',
    '||telemetry.vendor.example^$third-party'
  ])
})

test('blocks a listed domain loaded by another site', t => {
  t.true(isBlocked('https://tracker.example/t.js', 'https://news.example.org/'))
  t.true(isBlocked('https://telemetry.vendor.example/v1', 'https://news.example.org/', 'xhr'))
})

test('allows a listed domain on its own site', t => {
  t.false(isBlocked('https://tracker.example/app.js', 'https://tracker.example/'))
  t.false(
    isBlocked('https://tracker.example/app.css', 'https://www.tracker.example/', 'stylesheet')
  )
  t.false(isBlocked('https://telemetry.vendor.example/app.js', 'https://vendor.example/'))
})
