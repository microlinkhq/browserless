'use strict'

/**
 * Pass the Webdriver Test.
 * Will delete `navigator.webdriver` property.
 */
module.exports = page =>
  page.evaluateOnNewDocument(() => delete Object.getPrototypeOf(navigator).webdriver)
