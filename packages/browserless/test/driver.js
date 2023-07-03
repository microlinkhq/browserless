'use strict'

const { createBrowser } = require('@browserless/test/util')
const psList = require('ps-list')
const test = require('ava')

const getChromiumPs = async () => {
  const ps = await psList()
  return ps.filter(ps => ps.name.includes('Chromium'))
}

test.serial('.close() will kill process and subprocess', async t => {
  t.is((await getChromiumPs()).length, 0)

  const browserlessFactory = createBrowser()
  t.teardown(() => browserlessFactory.close())

  t.is((await getChromiumPs()).length, 1)
  t.is((await getChromiumPs())[0].pid, (await browserlessFactory.browser()).process().pid)

  const browserless = await browserlessFactory.createContext()
  t.is((await getChromiumPs()).length, 3)

  await browserless.destroyContext()
  t.is((await getChromiumPs()).length, 3)

  await browserlessFactory.close()
  t.is((await getChromiumPs()).length, 0)
})

test.serial('.close() is idempotency', async t => {
  t.is((await getChromiumPs()).length, 0)

  const browserlessFactory = createBrowser()
  t.is((await getChromiumPs()).length, 1)

  await browserlessFactory.close()
  t.is((await getChromiumPs()).length, 0)

  await browserlessFactory.close()
  t.is((await getChromiumPs()).length, 0)
})
