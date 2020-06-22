'use strict'

/**
 *
 * Prevent detect Puppeteer via variable name
 *
 * References:
 * - https://github.com/digitalhurricane-io/puppeteer-detection-100-percent
 * - https://github.com/berstend/puppeteer-extra/issues/209
 */
module.exports = page =>
  page.evaluateOnNewDocument(() => {
    const errors = {
      Error,
      EvalError,
      RangeError,
      ReferenceError,
      SyntaxError,
      TypeError,
      URIError
    }
    for (const name in errors) {
      globalThis[name] = (function (NativeError) {
        return function (message) {
          const err = new NativeError(message)
          const stub = {
            message: err.message,
            name: err.name,
            toString: () => err.toString(),
            get stack () {
              const lines = err.stack.split('\n')
              lines.splice(1, 1) // remove anonymous function above
              lines.pop() // remove puppeteer line
              return lines.join('\n')
            }
          }
          if (this === globalThis) {
            // called as function, not constructor
            stub.__proto__ = NativeError
            return stub
          }
          Object.assign(this, stub)
          this.__proto__ = NativeError
        }
      })(errors[name])
    }
  })
