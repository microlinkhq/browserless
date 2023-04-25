'use strict'

module.exports = async ({ url, browserless, opts }) => {
  const page = await browserless.page()
  const response = await page.goto(url, opts)
  const status = response.status()
  await page.close()
  return [JSON.stringify(status), JSON.stringify(status, null, 2)]
}
