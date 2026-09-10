'use strict'

const test = require('ava')
const createGoto = require('../../src')

const createPage = ({ browser, clientCalls }) => {
  let clientRequests = 0
  const noop = () => Promise.resolve()
  const client = {
    send: (method, params) => {
      clientCalls.push(method)
      if (method === 'Emulation.getScreenInfos') {
        return Promise.resolve({
          screenInfos: [{ id: 'primary', width: 800, height: 600, isPrimary: true }]
        })
      }
      if (method === 'Emulation.updateScreen') {
        return Promise.resolve({ screenInfo: { id: params.screenId, ...params } })
      }
      return Promise.resolve()
    }
  }

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
      clientRequests += 1
      if (clientRequests === 1) throw new Error('session not ready')
      return client
    }
  }
}

test('a failed screen fit does not block later navigations on the same browser', async t => {
  const goto = createGoto({ timeout: 10000 })
  const browser = { version: () => Promise.resolve('Chrome/152.0.7977.83') }
  const clientCalls = []
  const page = createPage({ browser, clientCalls })
  const opts = { url: 'about:blank', waitUntil: 'load', adblock: false }

  await goto(page, opts)
  t.deepEqual(clientCalls, [])

  await goto(page, opts)
  t.deepEqual(clientCalls, ['Emulation.getScreenInfos', 'Emulation.updateScreen'])

  await goto(page, opts)
  t.deepEqual(clientCalls, ['Emulation.getScreenInfos', 'Emulation.updateScreen'])
})
