'use strict'

const { getBrowserContext } = require('@browserless/test/util')
const test = require('ava')

const createLighthouse = require('..')

const lighthouse = t => createLighthouse(() => getBrowserContext(t))

test.serial('default configuration', async t => {
  const url = 'https://example.com'
  const report = await lighthouse(t)(url)
  t.true(report.audits['screenshot-thumbnails'].details.items.length > 0)
  t.snapshot(report.configSettings)
})

test.serial('customize default configuration', async t => {
  const url = 'https://kikobeats.com'
  const report = await lighthouse(t)(url, { onlyAudits: ['accessibility'] })
  t.deepEqual(report.configSettings.onlyAudits, ['accessibility'])
  t.snapshot(report.configSettings)
})

test.serial('specifying custom different configuration', async t => {
  const url = 'https://example.vercel.sh'
  const report = await lighthouse(t)(url, { preset: 'lr-desktop' })
  t.snapshot(report.configSettings)
})

test.serial('passing a different serializer', async t => {
  const url = 'https://javivelasco.com'
  const report = await lighthouse(t)(url, {
    onlyAudits: ['accessibility'],
    output: 'html'
  })
  t.true(report.startsWith('<!--'))
  t.snapshot(report.configSettings)
})

test.serial('handle timeout', async t => {
  const url = 'https://germanro.vercel.app'

  const error = await t.throwsAsync(
    lighthouse(t)(url, {
      timeout: 500,
      onlyAudits: ['accessibility'],
      output: 'html'
    })
  )

  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EBRWSRTIMEOUT')
})
