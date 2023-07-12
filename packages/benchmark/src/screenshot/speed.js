'use strict'

const createBrowser = require('browserless')
const path = require('path')

const remoteBrowser = createBrowser()

const optimizeForSpeed = process.argv[2] === 'true'

const fileUrl = `file://${path.join(__dirname, './fixtures/example.html')}`

/**
 * Run:
 * $ hyperfine -L optimizeForSpeed false,true 'node src/screenshot/speed.js {optimizeForSpeed}'
 */
const main = async () => {
  const browserless = await remoteBrowser.createContext()
  await browserless.screenshot(fileUrl, { optimizeForSpeed })
  await browserless.destroyContext()
  await remoteBrowser.close()
}

main()
  .then(remoteBrowser.close)
  .catch(error => {
    console.log(error)
    process.exit(1)
  })
