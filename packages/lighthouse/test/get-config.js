'use strict'

const { generateConfig } = require('lighthouse')
const { readdirSync } = require('fs')
const path = require('path')
const test = require('ava')

const { getConfig } = require('..')

const defaultConfig = generateConfig()
const configDir = path.resolve(__dirname, '../node_modules/lighthouse/lighthouse-core/config')
const files = readdirSync(configDir)

const excludesFiles = [
  'budget.js',
  'config-helpers.js',
  'config-plugin.js',
  'config.js',
  'constants.js',
  'metrics-to-audits.js'
]

const configs = files
  .filter(n => !excludesFiles.includes(n))
  .map(n => n.replace('.js', '').replace('-config', ''))

test('load default by default', t => {
  const config = generateConfig(getConfig())
  t.deepEqual(JSON.stringify(config), JSON.stringify(defaultConfig))
})

configs.forEach(preset => {
  test(`preset \`${preset}\``, t => {
    const config = generateConfig(getConfig({ preset }))
    const configPath = `lighthouse/lighthouse-core/config/${preset}-config.js`
    const baseConfig = generateConfig(require(configPath))

    t.deepEqual(JSON.stringify(config), JSON.stringify(baseConfig))
  })
})
