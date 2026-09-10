'use strict'

const test = require('ava')

const { getClientHints, getScreen } = require('../../src/emulation')

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

  t.is(platform, 'Linux armv81')
  t.like(userAgentMetadata, {
    platform: 'Android',
    platformVersion: '7.0.0',
    model: 'SM-G950U',
    mobile: true,
    formFactors: ['Mobile']
  })
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

test('non Chrome user agents get no client hints', t => {
  const userAgents = [
    undefined,
    'googlebot',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.83 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/152.0.0.0 Safari/537.36'
  ]

  for (const userAgent of userAgents) t.deepEqual(getClientHints(userAgent), {}, userAgent)
})

test('desktop screen is the smallest common resolution that fits the viewport', t => {
  t.deepEqual(getScreen({ width: 1280, height: 800 }), { width: 1440, height: 900 })
  t.deepEqual(getScreen({ width: 1366, height: 768 }), { width: 1366, height: 768 })
  t.deepEqual(getScreen({ width: 1920, height: 1200 }), { width: 2560, height: 1440 })
  t.deepEqual(getScreen({ width: 5000, height: 3000 }), { width: 5000, height: 3000 })
})
