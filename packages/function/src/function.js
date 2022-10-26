'use strict'

const path = require('path')

const createVm = require('./vm')

const scriptPath = path.resolve(__dirname, 'function.js')

const createFn = code => `
async ({ url, gotoOpts, browserWSEndpoint, ...opts }) => {
  const { serializeError } = require('serialize-error')

  const getBrowserless = require('browserless')
  const browserless = await getBrowserless({ mode: 'connect', browserWSEndpoint }).createContext()
  const fnWrapper = fn => (page, response) => {
    if (!response && opts.response) {
      const { status, statusText, headers, html } = opts.response
      response = {
        ok: () => status === 0 || (status >= 200 && opts.status <= 299),
        fromCache: () => false,
        fromServiceWorker: () => false,
        url: () => url,
        text: () => html,
        statusText: () => statusText,
        json: () => JSON.parse(html),
        headers: () => headers,
        status: () => status
      }
    }

    return fn({ ...opts, page, response, url })
  }
  const browserFn = browserless.evaluate(fnWrapper(${code}), gotoOpts)

  try {
    const value = await browserFn(url)
    await browserless.destroyContext()
    return { isFulfilled: true, isRejected: false, value }
  } catch (error) {
    await browserless.destroyContext()
    return { isFulfilled: false, isRejected: true, reason: serializeError(error) }
  }
}`

module.exports = ({ url, code, vmOpts, gotoOpts, browserWSEndpoint, ...opts }) => {
  const vm = createVm(vmOpts)
  const fn = createFn(code)
  const run = vm(fn, scriptPath)
  return run({ url, gotoOpts, browserWSEndpoint, ...opts })
}
