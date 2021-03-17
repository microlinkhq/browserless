'use strict'

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

    return async (...args) => {
      try {
        return {
          isFulfilled: true,
          isRejected: false,
          value: await run(...args)
        }
      } catch (error) {
        return {
          isFulfilled: false,
          isRejected: true,
          reason: error
        }
      }
    }
  }
}
