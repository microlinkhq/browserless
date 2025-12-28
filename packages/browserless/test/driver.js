'use strict'

const { createBrowser } = require('@browserless/test')
const psList = require('ps-list')
const test = require('ava')

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
