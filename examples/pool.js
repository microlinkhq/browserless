'use strict'

const createBrowserless = require('..')
const browserlessPool = createBrowserless.pool()

require('./main')(async url => {
  // get a browserless instance from the pool
  browserlessPool(async browserless => {
    // get a page from the browser instance
    const page = await browserless.page()
    await browserless.goto(page, { url: url.toString() })
    const html = await page.content()
    return html
  })
})
