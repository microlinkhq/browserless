'use strict'

const test = require('ava')
const createGoto = require('../../src')

const createSession = () => {
  const calls = []
  return {
    calls,
    client: {
      send: (method, params) => {
        calls.push({ method, params })
        return Promise.resolve()
      }
    }
  }
}

const createPage = () => {
  let viewport = null
  const sessions = [createSession()]
  const noop = () => Promise.resolve()
  const browser = { version: () => Promise.resolve('Chrome/152.0.7977.83') }
  return {
    sessions,
    swapSession: () => sessions.push(createSession()),
    setViewport: async next => {
      viewport = next
    },
    viewport: () => viewport,
    setExtraHTTPHeaders: noop,
    setUserAgent: noop,
    emulateMediaFeatures: noop,
    addStyleTag: noop,
    goto: () => Promise.resolve(null),
    waitForNetworkIdle: noop,
    browser: () => browser,
    _client: () => sessions[sessions.length - 1].client
  }
}

const screenOverrides = session =>
  session.calls
    .filter(({ method }) => method === 'Emulation.setDeviceMetricsOverride')
    .map(
      ({ params }) =>
        `${params.width}x${params.height} screen ${params.screenWidth}x${params.screenHeight}`
    )

const navigate = (goto, page, opts) =>
  goto(page, { url: 'about:blank', waitUntil: 'load', adblock: false, ...opts })

test('a desktop page gets its screen once, not on every navigation', async t => {
  const goto = createGoto({ timeout: 10000 })
  const page = createPage()

  await navigate(goto, page)
  await navigate(goto, page)
  await navigate(goto, page)

  t.deepEqual(screenOverrides(page.sessions[0]), ['1280x800 screen 1440x900'])
})

test('a puppeteer re-apply of the viewport re-applies the screen right away', async t => {
  const goto = createGoto({ timeout: 10000 })
  const page = createPage()

  await navigate(goto, page)
  await page.setViewport(page.viewport())

  t.deepEqual(screenOverrides(page.sessions[0]), [
    '1280x800 screen 1440x900',
    '1280x800 screen 1440x900'
  ])
})

test('a swapped primary session gets the screen on the next navigation', async t => {
  const goto = createGoto({ timeout: 10000 })
  const page = createPage()

  await navigate(goto, page)
  page.swapSession()
  await navigate(goto, page)
  await navigate(goto, page)

  t.deepEqual(screenOverrides(page.sessions[1]), ['1280x800 screen 1440x900'])
})

test('mobile viewports keep the screen chrome derives from the viewport', async t => {
  const goto = createGoto({ timeout: 10000 })
  const page = createPage()

  await navigate(goto, page, { device: 'iPhone 15' })
  await navigate(goto, page, { device: 'iPhone 15' })

  t.deepEqual(screenOverrides(page.sessions[0]), [])
})
