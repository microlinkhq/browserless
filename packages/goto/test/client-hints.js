'use strict'

const { runServer, getBrowserContext } = require('@browserless/test')
const test = require('ava')

const readHints = page =>
  page.evaluate(async () => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    brands: navigator.userAgentData.brands,
    hints: await navigator.userAgentData.getHighEntropyValues([
      'platform',
      'platformVersion',
      'fullVersionList'
    ])
  }))

const hintsServer = (t, requests = []) =>
  runServer(t, ({ req, res }) => {
    requests.push(req.headers)
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><h1>ok</h1></body></html>')
  })

test('Chrome user agent sends matching client hints', async t => {
  const browserless = await getBrowserContext(t)
  const requests = []
  const url = await hintsServer(t, requests)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    return readHints(page)
  })

  const state = await run()
  const major = state.userAgent.match(/Chrome\/(\d+)/)[1]

  t.true(requests[0]['sec-ch-ua'].includes(`"Google Chrome";v="${major}"`))
  t.true(state.brands.some(({ brand, version }) => brand === 'Google Chrome' && version === major))
  t.is(state.hints.platform, 'macOS')
  t.is(state.platform, 'MacIntel')
})

test('Windows and Linux user agents send matching client hints', async t => {
  const browserless = await getBrowserContext(t)
  const requests = []
  const url = await hintsServer(t, requests)
  const userAgents = {
    Windows:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    Linux:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
  }

  const run = browserless.withPage((page, goto) => async () => {
    const states = {}
    for (const [name, userAgent] of Object.entries(userAgents)) {
      requests.length = 0
      await goto(page, {
        url,
        headers: { 'user-agent': userAgent },
        waitUntil: 'load',
        adblock: false
      })
      states[name] = { headers: requests[0], ...(await readHints(page)) }
    }
    return states
  })

  const { Windows, Linux } = await run()
  t.is(Windows.headers['sec-ch-ua-platform'], '"Windows"')
  t.is(Windows.platform, 'Win32')
  t.is(Windows.hints.platform, 'Windows')
  t.is(Linux.headers['sec-ch-ua-platform'], '"Linux"')
  t.is(Linux.platform, 'Linux x86_64')
  t.is(Linux.hints.platform, 'Linux')
  t.is(Linux.hints.platformVersion, '')
})

test('Android Chrome device reports mobile client hints', async t => {
  const browserless = await getBrowserContext(t)
  const url = await hintsServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, device: 'Galaxy S8', waitUntil: 'load', adblock: false })
    return readHints(page)
  })

  const state = await run()
  t.true(state.brands.some(({ brand }) => brand === 'Google Chrome'))
  t.is(state.hints.platform, 'Android')
  t.is(state.platform, 'Linux armv81')
})

test('non Chrome user agents get no fabricated client hints', async t => {
  const browserless = await getBrowserContext(t)
  const requests = []
  const url = await hintsServer(t, requests)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, device: 'iPhone 15', waitUntil: 'load', adblock: false })
    const iphone = await readHints(page)
    await goto(page, {
      url,
      headers: { 'user-agent': 'googlebot' },
      waitUntil: 'load',
      adblock: false
    })
    const googlebot = await readHints(page)
    return [iphone, googlebot]
  })

  for (const state of await run()) t.deepEqual(state.brands, [])
  t.false(requests.some(headers => (headers['sec-ch-ua'] || '').includes('Google Chrome')))
})
