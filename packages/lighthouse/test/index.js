'use strict'

const test = require('ava')

const lighthouse = require('..')

test.serial('passing custom configuration', async t => {
  const url = 'https://kikobeats.com'
  const report = await lighthouse(url, { onlyAudits: ['accessibility'], device: 'mobile' })
  t.is(report.configSettings.emulatedFormFactor, 'mobile')
})

test.serial('passing a different serializer', async t => {
  const url = 'https://kikobeats.com'
  const report = await lighthouse(url, { onlyAudits: ['accessibility'], output: 'html' })
  t.true(report.startsWith('<!--'))
})
