'use strict'

const pReflect = require('p-reflect')
const { NodeVM } = require('vm2')
const merge = require('deepmerge')

const DEFAULT_VM_OPTS = {
  console: 'off',
  sandbox: {},
  require: {
    external: {
      modules: ['serialize-error', 'browserless']
    }
  }
}

const createVm = opts => new NodeVM(merge(DEFAULT_VM_OPTS, opts))

const compile = (vm, fn, scriptPath) => {
  const code = `'use strict'; module.exports = ${fn.toString()}`
  return vm.run(code, scriptPath)
}

module.exports = opts => {
  const vm = createVm(opts)

  return (fn, scriptPath) => {
    const run = compile(vm, fn, scriptPath)
    return (...args) => pReflect(run(...args))
  }
}
