'use strict'

const termImg = require('term-img')
const createBrowserless = require('browserless')
const browserless = createBrowserless()

require('./main')(async url => {
  const buffer = await browserless.screenshot(url.toString(), {
    hideElements: ['.crisp-client', '#cookies-policy'],
    overlay: {
      color: '#F76698'
    }
  })
  termImg(buffer)
})
