'use strict'

const { serializeError } = require('serialize-error')
const pReflect = require('p-reflect')
const { NodeVM } = require('vm2')

const createVm = opts =>
  new NodeVM({
    console: 'off',
    sandbox: {},
    ...opts
  })

const compile = (vm, fn, scriptPath) => {
  const code = `'use strict'; module.exports = ${fn.toString()}`
  return vm.run(code, scriptPath)
}

module.exports = opts => {
  const vm = createVm(opts)

  return (fn, scriptPath) => {
    const run = compile(vm, fn, scriptPath)
    return (...args) =>
      pReflect(run(...args)).then(result => {
        if (result.reason) result.reason = serializeError(result.reason)
        return result
      })
  }
}
