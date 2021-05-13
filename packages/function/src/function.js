/* eslint-disable no-eval */

'use strict'

const path = require('path')

const createVm = require('./vm')

const scriptPath = path.resolve(__dirname, 'function.js')

const createFn = code => `
async ({ url, query, gotoOpts, browserWSEndpoint }) => {
  const { serializeError } = require('serialize-error')

  const getBrowserless = require('browserless')
  const browserless = getBrowserless({ mode: 'connect', browserWSEndpoint }).createContext()
  const fnWrapper = fn => (page, response) => fn({ page, response, query })
  const browserFn = browserless.evaluate(fnWrapper(${eval(code)}), gotoOpts)

  try {
    const value = await browserFn(url)
    return { isFulfilled: true, isRejected: false, value }
  } catch(error) {
    return { isFulfilled: false, isRejected: true, reason: serializeError(error) }
  } finally {
    await browserless.destroyContext()
  }
}`

process.on('message', async ({ url, code, query, vmOpts, gotoOpts, browserWSEndpoint }) => {
  const vm = createVm(vmOpts)
  const fn = createFn(code)
  const run = vm(fn, scriptPath)
  process.send(await run({ url, query, gotoOpts, browserWSEndpoint }))
})
