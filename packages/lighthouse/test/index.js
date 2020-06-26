'use strict'

const test = require('ava')

const lighthouse = require('..')

const createBrowserless = require('browserless')

const { driver } = createBrowserless

const getBrowserless = () =>
  createBrowserless({
    args: [...driver.args, '--memory-pressure-off', '--single-process']
  })

test('passing custom configuration', async t => {
  const url = 'https://kikobeats.com'
  const report = await lighthouse(url, {
    getBrowserless,
    onlyAudits: ['accessibility'],
    device: 'mobile'
  })
  t.is(report.configSettings.emulatedFormFactor, 'mobile')
})

test('passing a different serializer', async t => {
  const url = 'https://kikobeats.com'
  const report = await lighthouse(url, {
    getBrowserless,
    onlyAudits: ['accessibility'],
    output: 'html'
  })
  t.true(report.startsWith('<!--'))
})

test('handle timeout', async t => {
  const url = 'https://kikobeats.com'

  const error = await t.throwsAsync(
    lighthouse(url, {
      getBrowserless,
      timeout: 50,
      onlyAudits: ['accessibility'],
      output: 'html'
    })
  )

  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EBRWSRTIMEOUT')
})
