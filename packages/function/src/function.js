'use strict'

const pReflect = require('p-reflect')
const path = require('path')

const createVm = require('./vm')

const scriptPath = path.resolve(__dirname, 'function.js')

const createFn = code => `
async ({ url, query, gotoOpts, browserWSEndpoint }) => {
  const getBrowserless = require('browserless')
  const browserless = getBrowserless({ mode: 'connect', browserWSEndpoint })

  const fnWrapper = fn => (page, response) => fn({ page, response, query })
  const browserFn = browserless.evaluate(fnWrapper(${code}), gotoOpts)

  return browserFn(url)
}`

process.on('message', async ({ url, code, query, vmOpts, gotoOpts, browserWSEndpoint }) => {
  const vm = createVm(vmOpts)
  const fn = createFn(code)
  const run = vm(fn, scriptPath)
  process.send(await pReflect(run({ url, query, gotoOpts, browserWSEndpoint })))
})
