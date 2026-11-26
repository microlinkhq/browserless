'use strict'

const { default: test } = require('ava')
const { PuppeteerBlocker, Request, fullLists } = require('@ghostery/adblocker-puppeteer')

const { HAGEZI_MULTI_PRO_URL, toThirdPartyRules } = require('../../../scripts/hagezi')
const { buildEngine } = require('../../../scripts/postinstall')

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

test('builds the engine from every ghostery list, its resources, and third-party hagezi rules', async t => {
  const ghostery = '||ads.example^$script'
  const resources = JSON.stringify({
    redirects: [
      { name: 'noop.js', aliases: [], body: 'void 0', contentType: 'application/javascript' }
    ],
    scriptlets: []
  })
  const urls = []
  const fetchImpl = url => {
    urls.push(url)
    let body = ghostery
    if (url === HAGEZI_MULTI_PRO_URL) body = '||tracker.example^'
    else if (url.endsWith('/ublock-origin/resources.json')) body = resources
    return Promise.resolve({ text: () => Promise.resolve(body) })
  }

  const engine = await buildEngine(fetchImpl)
  const match = (url, sourceUrl, type) =>
    engine.match(Request.fromRawDetails({ url, sourceUrl, type })).match
  const resourcesUrl = urls.find(url => url.endsWith('/ublock-origin/resources.json'))

  t.deepEqual([...urls].sort(), [...fullLists, HAGEZI_MULTI_PRO_URL, resourcesUrl].sort())
  t.true(match('https://ads.example/a.js', 'https://news.example.org/', 'script'))
  t.false(match('https://ads.example/a.png', 'https://news.example.org/', 'image'))
  t.true(match('https://tracker.example/t.js', 'https://news.example.org/', 'script'))
  t.false(match('https://tracker.example/app.js', 'https://tracker.example/', 'script'))
  t.is(engine.resources.checksum, String(resources.length))
  t.deepEqual(
    engine.resources.resources.map(resource => resource.body),
    ['void 0']
  )
})
