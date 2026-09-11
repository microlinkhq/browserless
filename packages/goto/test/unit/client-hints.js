'use strict'

const test = require('ava')

const { getClientHints } = require('../../src/client-hints')
const createGoto = require('../../src')

const macUserAgent = version =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`

const brandsOf = list => list.map(({ brand, version }) => `${brand}/${version}`)

test('brands match the GREASE order real Google Chrome 152 reports', t => {
  const { userAgentMetadata } = getClientHints(macUserAgent('152.0.7977.83'))

  t.deepEqual(brandsOf(userAgentMetadata.brands), [
    'Chromium/152',
    'Not?A_Brand/24',
    'Google Chrome/152'
  ])
  t.deepEqual(brandsOf(userAgentMetadata.fullVersionList), [
    'Chromium/152.0.7977.83',
    'Not?A_Brand/24.0.0.0',
    'Google Chrome/152.0.7977.83'
  ])
  t.is(userAgentMetadata.fullVersion, '152.0.7977.83')
})

test('brands match the GREASE order real Google Chrome Canary 154 reports', t => {
  const { userAgentMetadata } = getClientHints(macUserAgent('154.0.8013.0'))

  t.deepEqual(brandsOf(userAgentMetadata.brands), [
    'Chromium/154',
    'Google Chrome/154',
    'Not A(Brand/99'
  ])
})

test('reduced user agent takes the full version from the browser when majors match', t => {
  t.is(
    getClientHints(macUserAgent('152.0.0.0'), '152.0.7977.83').userAgentMetadata.fullVersion,
    '152.0.7977.83'
  )
  t.is(
    getClientHints(macUserAgent('150.0.0.0'), '152.0.7977.83').userAgentMetadata.fullVersion,
    '150.0.0.0'
  )
})

test('macOS user agent reports macOS hints', t => {
  const { platform, userAgentMetadata } = getClientHints(macUserAgent('152.0.7977.83'))

  t.is(platform, 'MacIntel')
  t.like(userAgentMetadata, {
    platform: 'macOS',
    architecture: 'arm',
    bitness: '64',
    model: '',
    mobile: false,
    wow64: false,
    formFactors: ['Desktop']
  })
})

test('Windows user agent reports Windows hints', t => {
  const { platform, userAgentMetadata } = getClientHints(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
  )

  t.is(platform, 'Win32')
  t.like(userAgentMetadata, {
    platform: 'Windows',
    platformVersion: '19.0.0',
    architecture: 'x86',
    bitness: '64',
    mobile: false
  })
})

test('Android user agent reports a mobile device with its model', t => {
  const { platform, userAgentMetadata } = getClientHints(
    'Mozilla/5.0 (Linux; Android 7.0; SM-G950U Build/NRD90M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.83 Mobile Safari/537.36'
  )

  t.is(platform, 'Linux armv8l')
  t.like(userAgentMetadata, {
    platform: 'Android',
    platformVersion: '7.0.0',
    model: 'SM-G950U',
    mobile: true,
    formFactors: ['Mobile']
  })
})

test('Android WebView user agent reports the Android WebView brand', t => {
  const { platform, userAgentMetadata } = getClientHints(
    'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/152.0.7977.83 Mobile Safari/537.36'
  )

  t.is(platform, 'Linux armv8l')
  t.deepEqual(brandsOf(userAgentMetadata.brands), [
    'Chromium/152',
    'Not?A_Brand/24',
    'Android WebView/152'
  ])
  t.false(userAgentMetadata.brands.some(({ brand }) => brand === 'Google Chrome'))
  t.like(userAgentMetadata, { platform: 'Android', model: 'Pixel 7', mobile: true })
})

test('Linux and Chrome OS user agents report their platform', t => {
  const linux = getClientHints(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
  )
  t.is(linux.platform, 'Linux x86_64')
  t.like(linux.userAgentMetadata, { platform: 'Linux', architecture: 'x86', bitness: '64' })

  const chromeOS = getClientHints(
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
  )
  t.is(chromeOS.platform, 'Linux x86_64')
  t.like(chromeOS.userAgentMetadata, { platform: 'Chrome OS', platformVersion: '14541.0.0' })
})

test('Linux user agent reports an empty platform version like Chromium does', t => {
  const { userAgentMetadata } = getClientHints(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
  )

  t.is(userAgentMetadata.platformVersion, '')
})

test('Chromium based browsers with their own brand get no client hints', t => {
  const userAgents = [
    'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 OPR/110.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 YaBrowser/24.1.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Vivaldi/7.1.3570.39'
  ]

  for (const userAgent of userAgents) t.deepEqual(getClientHints(userAgent), {}, userAgent)
})

const goto = createGoto({ timeout: 10000 })

const createMockPage = ({ browser, userAgentOverrides }) => {
  const noop = () => Promise.resolve()
  return {
    setViewport: noop,
    viewport: () => null,
    setExtraHTTPHeaders: noop,
    setUserAgent: options => {
      userAgentOverrides.push(options)
      return Promise.resolve()
    },
    emulateMediaFeatures: noop,
    addStyleTag: noop,
    goto: () => Promise.resolve(null),
    waitForNetworkIdle: noop,
    browser: () => browser,
    _client: () => ({ send: noop })
  }
}

const gotoWithUserAgent = (page, userAgent) =>
  goto(page, {
    url: 'about:blank',
    headers: { 'user-agent': userAgent },
    waitUntil: 'load',
    adblock: false
  })

test('a browser version lookup that never settles does not block the user agent override', async t => {
  const userAgentOverrides = []
  const browser = { version: () => new Promise(() => {}) }
  const page = createMockPage({ browser, userAgentOverrides })
  const userAgent = macUserAgent('152.0.0.0')

  const outcome = await Promise.race([
    gotoWithUserAgent(page, userAgent).then(() => 'navigated'),
    new Promise(resolve => setTimeout(resolve, 3000, 'blocked'))
  ])

  t.is(outcome, 'navigated')
  t.is(userAgentOverrides.length, 1)
  t.is(userAgentOverrides[0].userAgent, userAgent)
  t.is(userAgentOverrides[0].userAgentMetadata.fullVersion, '152.0.0.0')
})

test('a hung or failed browser version lookup runs once per browser', async t => {
  const lookupResults = {
    hung: () => new Promise(() => {}),
    failed: () => Promise.reject(new Error('Target closed'))
  }

  for (const [name, lookupResult] of Object.entries(lookupResults)) {
    const userAgentOverrides = []
    let lookups = 0
    const browser = {
      version: () => {
        lookups++
        return lookupResult()
      }
    }
    const page = createMockPage({ browser, userAgentOverrides })

    await gotoWithUserAgent(page, macUserAgent('152.0.0.0'))
    await gotoWithUserAgent(page, macUserAgent('152.0.0.0'))

    t.is(lookups, 1, name)
    t.deepEqual(
      userAgentOverrides.map(({ userAgentMetadata }) => userAgentMetadata.fullVersion),
      ['152.0.0.0', '152.0.0.0'],
      name
    )
  }
})

test('a reduced user agent header gets the browser full version on the first navigation', async t => {
  const userAgentOverrides = []
  const browser = { version: () => Promise.resolve('Chrome/152.0.7977.83') }
  const page = createMockPage({ browser, userAgentOverrides })

  await gotoWithUserAgent(page, macUserAgent('152.0.0.0'))

  t.is(userAgentOverrides.length, 1)
  t.is(userAgentOverrides[0].userAgentMetadata.fullVersion, '152.0.7977.83')
})

test('non Chrome user agents get no client hints', t => {
  const userAgents = [
    undefined,
    'googlebot',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.83 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/152.0.0.0 Safari/537.36'
  ]

  for (const userAgent of userAgents) t.deepEqual(getClientHints(userAgent), {}, userAgent)
})
