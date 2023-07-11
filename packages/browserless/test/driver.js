'use strict'

const { createBrowser } = require('@browserless/test/util')
const psList = require('ps-list')
const isCI = require('is-ci')
const test = require('ava')

const getChromiumPs = async () => {
  const ps = await psList()
  return ps.filter(ps => ps.name === 'Google Chrome for Testing')
}

;(isCI ? test.skip : test.serial)('.close() will kill process and subprocess', async t => {
  const initialPs = await getChromiumPs()

  const browserlessFactory = createBrowser()
  t.teardown(() => browserlessFactory.close())

  t.is((await getChromiumPs()).length, 1)
  t.is((await getChromiumPs())[0].pid, (await browserlessFactory.browser()).process().pid)

  const browserless = await browserlessFactory.createContext()
  t.is((await getChromiumPs()).length, 1)

  await browserless.destroyContext()
  t.is((await getChromiumPs()).length, 1)

  await browserlessFactory.close()
  t.is((await getChromiumPs()).length, initialPs.length)
})
;(isCI ? test.skip : test.serial)('.close() is idempotency', async t => {
  const initialPs = await getChromiumPs()

  const browserlessFactory = createBrowser()
  t.is((await getChromiumPs()).length, 1)

  await browserlessFactory.close()
  t.is((await getChromiumPs()).length, initialPs.length)

  await browserlessFactory.close()
  t.is((await getChromiumPs()).length, initialPs.length)
})
