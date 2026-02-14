'use strict'

const test = require('ava')

const { runServer, getBrowserContext } = require('@browserless/test')

const getUrl = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><h1>hello</h1></body></html>')
  })

test('setup autoconsent when `adblock` is enabled', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    const calls = []
    const originalExposeFunction = page.exposeFunction.bind(page)

    page.exposeFunction = (...args) => {
      calls.push(args[0])
      return originalExposeFunction(...args)
    }

    await goto(page, { url })
    return calls
  })

  const calls = await run()

  t.true(calls.includes('autoconsentSendMessage'))
})

test('skip autoconsent setup when `adblock` is false', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    const calls = []
    const originalExposeFunction = page.exposeFunction.bind(page)

    page.exposeFunction = (...args) => {
      calls.push(args[0])
      return originalExposeFunction(...args)
    }

    await goto(page, { url, adblock: false })
    return calls
  })

  const calls = await run()

  t.false(calls.includes('autoconsentSendMessage'))
})

test('`disableAdblock` removes blocker listeners and keeps request interception enabled', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    const interceptionCalls = []
    const originalSetRequestInterception = page.setRequestInterception.bind(page)
    page.setRequestInterception = enabled => {
      interceptionCalls.push(enabled)
      return originalSetRequestInterception(enabled)
    }

    await goto(page, { url, adblock: true })

    const listenersBeforeDisable = {
      request: page.listenerCount('request'),
      frameattached: page.listenerCount('frameattached'),
      domcontentloaded: page.listenerCount('domcontentloaded')
    }

    await page.disableAdblock()
    const listenersAfterDisable = {
      request: page.listenerCount('request'),
      frameattached: page.listenerCount('frameattached'),
      domcontentloaded: page.listenerCount('domcontentloaded')
    }
    await page.disableAdblock()

    return { interceptionCalls, listenersBeforeDisable, listenersAfterDisable }
  })

  const { interceptionCalls, listenersBeforeDisable, listenersAfterDisable } = await run()

  t.true(interceptionCalls.includes(true))
  t.false(interceptionCalls.includes(false))

  t.true(listenersAfterDisable.request < listenersBeforeDisable.request)
  t.true(listenersAfterDisable.frameattached <= listenersBeforeDisable.frameattached)
  t.true(listenersAfterDisable.domcontentloaded <= listenersBeforeDisable.domcontentloaded)
})
