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
  t.is(launchOptions.ignoreDefaultArgs, undefined)
})

test('spawn does not override the browser user agent', async t => {
  let launchOptions
  const puppeteer = createFakePuppeteer(options => {
    launchOptions = options
  })

  await driver.spawn({ puppeteer })

  // `--user-agent` blanks Chrome's high entropy client hints browser wide, and
  // service worker scopes cannot get them back over CDP; see the worker client
  // hints test in @browserless/goto.
  t.false(launchOptions.args.some(arg => arg.startsWith('--user-agent=')))
})

test('spawn keeps user ignoreDefaultArgs as is', async t => {
  let launchOptions
  const puppeteer = createFakePuppeteer(options => {
    launchOptions = options
  })

  await driver.spawn({ puppeteer, ignoreDefaultArgs: ['--foo'] })

  t.deepEqual(launchOptions.ignoreDefaultArgs, ['--foo'])
})

test('spawn preserves ignoreDefaultArgs=true', async t => {
  let launchOptions
  const puppeteer = createFakePuppeteer(options => {
    launchOptions = options
  })

  await driver.spawn({ puppeteer, ignoreDefaultArgs: true })

  t.true(launchOptions.ignoreDefaultArgs)
})
