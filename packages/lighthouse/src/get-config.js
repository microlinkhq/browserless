'use strict'

const preset = name =>
  name
    ? import(`lighthouse/core/config/${name}-config.js`)
      .then(mod => mod.default)
      .catch(() => undefined)
    : undefined

module.exports = async ({ preset: presetName, ...settings } = {}) => {
  const presetConfig = (await preset(presetName)) || { extends: 'lighthouse:default' }
  const config = { ...presetConfig }
  if (Object.keys(settings).length > 0) config.settings = { ...presetConfig.settings, ...settings }
  return config
}
