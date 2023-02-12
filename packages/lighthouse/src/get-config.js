'use strict'

const preset = name =>
  name
    ? import(`lighthouse/core/config/${name}-config.js`)
      .then(mod => mod.default)
      .catch(() => undefined)
    : undefined

module.exports = async ({ preset: presetName, ...settings } = {}) => {
  const config = (await preset(presetName)) || { extends: 'lighthouse:default' }
  if (Object.keys(settings).length > 0) config.settings = { ...config.settings, ...settings }
  return config
}
