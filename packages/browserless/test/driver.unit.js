'use strict'

const test = require('ava')
const createCapture = require('@browserless/capture')

const driver = require('../src/driver')

const createFakePuppeteer = onLaunch => ({
  launch: async options => {
    onLaunch(options)
    return {
      isConnected: () => true,
      close: async () => {},
      process: () => ({ pid: 1 })
    }
  }
})

test('spawn adds capture extension launch args by default', async t => {
  let launchOptions
  const puppeteer = createFakePuppeteer(options => {
    launchOptions = options
  })

  await driver.spawn({ puppeteer })

  t.truthy(launchOptions)
  t.true(launchOptions.args.includes(`--allowlisted-extension-id=${createCapture.extensionId}`))
  t.true(launchOptions.args.includes(`--disable-extensions-except=${createCapture.extensionPath}`))
  t.true(launchOptions.args.includes(`--load-extension=${createCapture.extensionPath}`))
  t.deepEqual(launchOptions.ignoreDefaultArgs, ['--disable-extensions'])
})

test('spawn merges user ignoreDefaultArgs with extension requirement', async t => {
  let launchOptions
  const puppeteer = createFakePuppeteer(options => {
    launchOptions = options
  })

  await driver.spawn({ puppeteer, ignoreDefaultArgs: ['--foo'] })

  t.deepEqual(launchOptions.ignoreDefaultArgs, ['--foo', '--disable-extensions'])
})

test('spawn preserves ignoreDefaultArgs=true', async t => {
  let launchOptions
  const puppeteer = createFakePuppeteer(options => {
    launchOptions = options
  })

  await driver.spawn({ puppeteer, ignoreDefaultArgs: true })

  t.true(launchOptions.ignoreDefaultArgs)
})
