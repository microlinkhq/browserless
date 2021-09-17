'use strict'

const path = require('path')

const createVm = require('./vm')

const scriptPath = path.resolve(__dirname, 'function.js')

const createFn = code => `
async ({ url, query, gotoOpts, browserWSEndpoint }) => {
  const { serializeError } = require('serialize-error')

  const getBrowserless = require('browserless')
  const browserless = await getBrowserless({ mode: 'connect', browserWSEndpoint }).createContext()
  const fnWrapper = fn => (page, response) => fn({ page, response, query })
  const browserFn = browserless.evaluate(fnWrapper(${code}), gotoOpts)

  try {
    const value = await browserFn(url)
    await browserless.destroyContext()
    return { isFulfilled: true, isRejected: false, value }
  } catch(error) {
    await browserless.destroyContext()
    return { isFulfilled: false, isRejected: true, reason: serializeError(error) }
  }
}`

process.on('message', async ({ url, code, query, vmOpts, gotoOpts, browserWSEndpoint }) => {
  const vm = createVm(vmOpts)
  const fn = createFn(code.endsWith(';') ? code.slice(0, -1) : code)
  const run = vm(fn, scriptPath)
  process.send(await run({ url, query, gotoOpts, browserWSEndpoint }))
})
