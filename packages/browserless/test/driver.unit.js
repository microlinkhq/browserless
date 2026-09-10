'use strict'

const test = require('ava')

const driver = require('../src/driver')

const createFakePuppeteer = onLaunch => ({
  launch: async options => {
    onLaunch(options)
    return {
      connected: true,
      close: async () => {},
      process: () => ({ pid: 1 })
    }
  }
})

test('spawn does not add capture extension launch args by default', async t => {
  let launchOptions
  const puppeteer = createFakePuppeteer(options => {
    launchOptions = options
  })

  await driver.spawn({ puppeteer })

  t.truthy(launchOptions)
  t.false(launchOptions.args.some(arg => arg.startsWith('--allowlisted-extension-id=')))
  t.false(launchOptions.args.some(arg => arg.startsWith('--disable-extensions-except=')))
  t.false(launchOptions.args.some(arg => arg.startsWith('--load-extension=')))
  t.deepEqual(launchOptions.ignoreDefaultArgs, driver.ignoreDefaultArgs)
})

test('spawn merges user ignoreDefaultArgs with the default list', async t => {
  let launchOptions
  const puppeteer = createFakePuppeteer(options => {
    launchOptions = options
  })

  await driver.spawn({ puppeteer, ignoreDefaultArgs: ['--foo'] })

  t.deepEqual(launchOptions.ignoreDefaultArgs, [...driver.ignoreDefaultArgs, '--foo'])
})

test('spawn does not duplicate ignoreDefaultArgs already in the default list', async t => {
  let launchOptions
  const puppeteer = createFakePuppeteer(options => {
    launchOptions = options
  })

  await driver.spawn({ puppeteer, ignoreDefaultArgs: ['--disable-extensions'] })

  t.deepEqual(launchOptions.ignoreDefaultArgs, driver.ignoreDefaultArgs)
})

test('spawn preserves ignoreDefaultArgs=true', async t => {
  let launchOptions
  const puppeteer = createFakePuppeteer(options => {
    launchOptions = options
  })

  await driver.spawn({ puppeteer, ignoreDefaultArgs: true })

  t.true(launchOptions.ignoreDefaultArgs)
})
