'use strict'

const { readdirSync } = require('fs')
const path = require('path')
const test = require('ava')

const getConfig = require('../src/get-config')

const configDir = path.resolve(__dirname, '../node_modules/lighthouse/core/config')
const files = readdirSync(configDir)

const configs = files
  .filter(n => n.endsWith('-config.js'))
  .map(n => n.replace('.js', '').replace('-config', ''))

test('load default by default', async t => {
  const config = await getConfig()
  t.snapshot(config)
})

test('invalid preset', async t => {
  const config = await getConfig({ preset: 'notexist' })
  t.snapshot(config)
})

test('invalid preset with settings', async t => {
  const config = await getConfig({
    preset: 'notexist',
    skipAudits: ['uses-http2', 'bf-cache']
  })
  t.snapshot(config)
})

configs.forEach(preset => {
  test(`preset \`${preset}\``, async t => {
    const configPath = path.resolve(configDir, `${preset}-config.js`)
    const config = await import(configPath).then(mod => mod.default)
    t.deepEqual(await getConfig({ preset }), config)
  })
})

test('preset with settings', async t => {
  const config = await getConfig({ preset: 'lr-desktop', skipAudits: ['uses-http2'] })
  t.deepEqual(config.settings.skipAudits, ['uses-http2'])
})
