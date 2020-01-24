'use strict'

const createBrowserlessPool = require('@browserless/pool')

const browserlessPool = createBrowserlessPool({
  max: 2, // max browsers to keep open
  timeout: 30000 // max time a browser is consiedered fresh
})

process.on('exit', () => {
  browserlessPool.drain().then(() => browserlessPool.clear())
})

require('./main')(async url => {
  // get a browserless instance from the pool
  return browserlessPool(async browserless => {
    // get a page from the browser instance
    const page = await browserless.page()
    await browserless.goto(page, { url: url.toString() })
    const output = await page.content()
    return { output }
  })
})
