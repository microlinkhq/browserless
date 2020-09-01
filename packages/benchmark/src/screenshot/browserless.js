'use strict'

const createBrowserless = require('browserless')

const main = async () => {
  const browserless = await createBrowserless()
  await browserless.screenshot('https://example.com', {
    waitUntil: ['networkidle2', 'load']
  })
  await browserless.close()
}

main()
  .then(() => process.exit())
  .catch(() => process.exit(1))
