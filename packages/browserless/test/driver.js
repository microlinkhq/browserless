'use strict'

const { createBrowser, getBrowserContext, runServer } = require('@browserless/test')
const psList = require('ps-list')
const test = require('ava')
const browserless = require('..')

const isCI = !!process.env.CI

const getChromiumPs = async () => {
  const ps = await psList()
  return ps.filter(ps => ps.cmd.includes('Google Chrome for Testing')).length
}

;(isCI ? test.skip : test)('.close() will kill process and subprocess', async t => {
  const initialPs = await getChromiumPs()

  const browserlessFactory = createBrowser()
  t.teardown(browserlessFactory.close)

  const browserPid = (await browserlessFactory.browser()).process().pid

  t.truthy((await psList()).find(ps => ps.pid === browserPid))

  const runningPs = await getChromiumPs()

  const browserless = await browserlessFactory.createContext()

  t.is(runningPs, await getChromiumPs())

  await browserless.destroyContext()

  t.is(runningPs, await getChromiumPs())

  await browserlessFactory.close()

  t.is(initialPs, await getChromiumPs())
})
;(isCI ? test.skip : test)('.close() is idempotency', async t => {
  const initialPs = await getChromiumPs()

  const browserlessFactory = createBrowser()
  t.is(await getChromiumPs(), 1)

  await browserlessFactory.close()
  t.is(await getChromiumPs(), initialPs)

  await browserlessFactory.close()
  t.is(await getChromiumPs(), initialPs)
})

test('default args keep standard Web APIs exposed', async t => {
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><title>apis</title>')
  })
  const browserless = await getBrowserContext(t)

  const apis = await browserless.evaluate(page =>
    page.evaluate(() => ({
      Notification: typeof Notification,
      speechSynthesis: typeof speechSynthesis,
      webkitSpeechRecognition: typeof webkitSpeechRecognition,
      PushManager: typeof PushManager,
      PaymentRequest: typeof PaymentRequest
    }))
  )(url)

  t.deepEqual(apis, {
    Notification: 'function',
    speechSynthesis: 'object',
    webkitSpeechRecognition: 'function',
    PushManager: 'function',
    PaymentRequest: 'function'
  })
})

test('.close() disconnect in connect mode', async t => {
  const remoteBrowser = await browserless.driver.spawn()
  t.teardown(() => browserless.driver.close(remoteBrowser))

  const browserlessFactory = browserless({
    mode: 'connect',
    browserWSEndpoint: remoteBrowser.wsEndpoint()
  })
  t.teardown(browserlessFactory.close)

  const browser = await browserlessFactory.browser()

  t.true(browser.connected)

  await browserlessFactory.close()

  t.false(browser.connected)
})
