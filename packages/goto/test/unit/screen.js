'use strict'

const test = require('ava')
const createGoto = require('../../src')

const PRIMARY_SCREEN = { id: 'primary', width: 800, height: 600, isPrimary: true }

const createSession = () => {
  const session = {
    calls: [],
    clientReady: true,
    updateScreenError: undefined,
    client: {
      send: (method, params) => {
        session.calls.push(method)
        if (method === 'Emulation.getScreenInfos') {
          return Promise.resolve({ screenInfos: [PRIMARY_SCREEN] })
        }
        if (method === 'Emulation.updateScreen') {
          return session.updateScreenError
            ? Promise.reject(session.updateScreenError)
            : Promise.resolve({ screenInfo: { ...PRIMARY_SCREEN, ...params } })
        }
        return Promise.resolve()
      }
    }
  }
  return session
}

const createPage = session => {
  const noop = () => Promise.resolve()
  const browser = { version: () => Promise.resolve('Chrome/152.0.7977.83') }
  return {
    setViewport: noop,
    viewport: () => null,
    setExtraHTTPHeaders: noop,
    setUserAgent: noop,
    emulateMediaFeatures: noop,
    addStyleTag: noop,
    goto: () => Promise.resolve(null),
    waitForNetworkIdle: noop,
    browser: () => browser,
    _client: () => {
      if (!session.clientReady) throw new Error('session not ready')
      return session.client
    }
  }
}

const navigate = (goto, page) =>
  goto(page, { url: 'about:blank', waitUntil: 'load', adblock: false })

const targetCloseError = () =>
  Object.assign(new Error('Target closed'), { name: 'TargetCloseError' })

test('a failed screen read does not block later navigations on the same browser', async t => {
  const goto = createGoto({ timeout: 10000 })
  const session = createSession()
  const page = createPage(session)

  session.clientReady = false
  await navigate(goto, page)
  t.deepEqual(session.calls, [])

  session.clientReady = true
  await navigate(goto, page)
  t.deepEqual(session.calls, ['Emulation.getScreenInfos', 'Emulation.updateScreen'])

  await navigate(goto, page)
  t.deepEqual(session.calls, ['Emulation.getScreenInfos', 'Emulation.updateScreen'])
})

test('a screen update interrupted by a closed target is retried on the next navigation', async t => {
  const goto = createGoto({ timeout: 10000 })
  const session = createSession()
  const page = createPage(session)

  session.updateScreenError = targetCloseError()
  await navigate(goto, page)
  t.deepEqual(session.calls, ['Emulation.getScreenInfos', 'Emulation.updateScreen'])

  session.updateScreenError = undefined
  await navigate(goto, page)
  t.deepEqual(session.calls, [
    'Emulation.getScreenInfos',
    'Emulation.updateScreen',
    'Emulation.updateScreen'
  ])

  await navigate(goto, page)
  t.is(session.calls.length, 3)
})

test('an unsupported screen update is not retried on every navigation', async t => {
  const goto = createGoto({ timeout: 10000 })
  const session = createSession()
  const page = createPage(session)

  session.updateScreenError = new Error('Screen emulation is only supported in headless mode')
  await navigate(goto, page)
  await navigate(goto, page)
  await navigate(goto, page)

  t.deepEqual(session.calls, ['Emulation.getScreenInfos', 'Emulation.updateScreen'])
})
