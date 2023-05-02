'use strict'

const createBrowserless = require('browserless')

const main = async () => {
  const browserless = await createBrowserless()
  await browserless.screenshot('https://example.com', { type: 'png' })
  await browserless.close()
}

main().catch(() => process.exit(1))
