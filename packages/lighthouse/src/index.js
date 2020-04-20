'use strict'

const requireOneOf = require('require-one-of')
const lighthouse = require('lighthouse')

// See https://github.com/GoogleChrome/lighthouse/blob/master/docs/readme.md#configuration
const getLighthouseConfiguration = ({
  onlyCategories = ['performance', 'best-practices', 'accessibility', 'seo'],
  device = 'desktop',
  ...props
}) => ({
  extends: 'lighthouse:default',
  settings: {
    onlyCategories,
    emulatedFormFactor: device,
    ...props
  }
})

const getOptions = (browser, { logLevel, output }) => ({
  port: new URL(browser.wsEndpoint()).port,
  output,
  logLevel
})

const getBrowser = async getBrowserless => {
  const browserless = await getBrowserless()
  const browser = await browserless.browser
  return browser
}

module.exports = async (
  url,
  {
    getBrowserless = requireOneOf(['browserless']),
    logLevel = 'error',
    output = 'json',
    ...opts
  } = {}
) => {
  const browser = await getBrowser(getBrowserless)
  const options = await getOptions(browser, { logLevel, output })
  const lighthouseConfig = getLighthouseConfiguration(opts)
  const { lhr, report } = await lighthouse(url, options, lighthouseConfig)
  return output === 'json' ? lhr : report
}
