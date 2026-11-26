'use strict'

const { spawnSync } = require('child_process')
const { default: test } = require('ava')
const { PuppeteerBlocker, Request, fullLists } = require('@ghostery/adblocker-puppeteer')
const fs = require('fs')
const os = require('os')
const path = require('path')

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

test('fetch supplies every response method the adblocker declares', t => {
  const checker = [
    "const fs = require('fs')",
    "const path = require('path')",
    "const { createRequire } = require('module')",
    "const { fetch } = require('./scripts/postinstall')",
    "const req = createRequire(require.resolve('@ghostery/adblocker-puppeteer'))",
    "const dts = path.join(path.dirname(req.resolve('@ghostery/adblocker')), 'fetch.d.ts')",
    "const src = fs.readFileSync(dts, 'utf8')",
    "const start = src.indexOf('interface FetchResponse')",
    "const body = src.slice(start, src.indexOf('}', start))",
    'const names = [...body.matchAll(/^\\s*(\\w+)\\s*:/gm)].map(match => match[1])',
    "if (!names.length) throw new Error('FetchResponse declares no methods')",
    "fetch('https://example.invalid/list.txt').then(async response => {",
    '  for (const name of names) {',
    "    if (typeof response[name] !== 'function') throw new Error('missing ' + name)",
    '    await response[name]()',
    '  }',
    "  console.log(names.join(','))",
    '}).catch(error => { console.error(error); process.exit(1) })'
  ].join('\n')
  const result = spawnSync(
    process.execPath,
    ['-r', path.join(__dirname, '../../fixtures/postinstall-hook.js'), '-e', checker],
    {
      cwd: path.join(__dirname, '../../..'),
      env: process.env,
      encoding: 'utf8'
    }
  )
  t.is(result.status, 0, result.stderr)
  t.is(result.stdout.trim(), 'text,arrayBuffer,json')
})

test('running postinstall writes that engine', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adblock-engine-'))
  const out = path.join(dir, 'engine.bin')
  try {
    const result = spawnSync(
      process.execPath,
      [
        '-r',
        path.join(__dirname, '../../fixtures/postinstall-hook.js'),
        path.join(__dirname, '../../../scripts/postinstall.js')
      ],
      {
        cwd: path.join(__dirname, '../../..'),
        env: { ...process.env, ENGINE_OUT: out },
        encoding: 'utf8'
      }
    )
    t.is(result.status, 0, result.stderr)
    const built = PuppeteerBlocker.deserialize(new Uint8Array(fs.readFileSync(out)))
    const match = (url, sourceUrl, type) =>
      built.match(Request.fromRawDetails({ url, sourceUrl, type })).match
    t.true(match('https://tracker.example/t.js', 'https://news.example.org/', 'script'))
    t.false(match('https://tracker.example/app.js', 'https://tracker.example/', 'script'))
    t.true(match('https://ads.example/a.js', 'https://news.example.org/', 'script'))
    t.false(match('https://ads.example/a.png', 'https://news.example.org/', 'image'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
