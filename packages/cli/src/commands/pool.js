'use strict'

const createBrowserlessPool = require('@browserless/pool')
const onExit = require('signal-exit')

const browserlessPool = createBrowserlessPool({
  max: 2, // max browsers to keep open
  timeout: 30000 // max time a browser is consiedered fresh
})

onExit(() => browserlessPool.drain().then(() => browserlessPool.clear()))

module.exports = async (url, opts) => {
  return browserlessPool(async browserless => {
    const page = await browserless.page()
    await browserless.goto(page, { url, ...opts })
    const output = await page.content()
    return output
  })
}
