'use strict'

const termImg = require('term-img')
const createBrowserless = require('browserless')
const browserless = createBrowserless()

require('./main')(async url => {
  const buffer = await browserless.screenshot(url.toString(), {
    hideElements: ['.crisp-client', '#cookies-policy'],
    overlay: {
      browser: 'safari-dark',
      background:
        'linear-gradient(45deg, rgba(255,18,223,1) 0%, rgba(69,59,128,1) 66%, rgba(69,59,128,1) 100%)' // '#f00'
    }
  })

  termImg(buffer)
  // require('fs').writeFileSync('screenshot.png', buffer)
})
