'use strict'

const termImg = require('term-img')
const createBrowserless = require('browserless')
const browserless = createBrowserless()

require('./main')(async url => {
  const buffer = await browserless.screenshot(url.toString(), {
    hideElements: ['.crisp-client', '#cookies-policy'],
    overlay: {
      browser: 'dark',
      color: '#6791B6'
    }
  })

  termImg(buffer)
  // require('fs').writeFileSync('screenshot.png', buffer)
})
