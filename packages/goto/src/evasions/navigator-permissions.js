'use strict'

/**
 * Pass the Permissions Test.
 */
module.exports = page =>
  page.evaluateOnNewDocument(() => {
    if (!window.Notification) {
      window.Notification = {
        permission: 'denied'
      }
    }

    const originalQuery = window.navigator.permissions.query
    // eslint-disable-next-line
    window.navigator.permissions.__proto__.query = parameters =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: window.Notification.permission })
        : originalQuery(parameters)

    // Inspired by: https://github.com/ikarienator/phantomjs_hide_and_seek/blob/master/5.spoofFunctionBind.js
    const oldCall = Function.prototype.call
    function call () {
      return oldCall.apply(this, arguments)
    }
    // eslint-disable-next-line
    Function.prototype.call = call

    const nativeToStringFunctionString = Error.toString().replace(/Error/g, 'toString')
    const oldToString = Function.prototype.toString

    function functionToString () {
      if (this === window.navigator.permissions.query) {
        return 'function query() { [native code] }'
      }
      if (this === functionToString) {
        return nativeToStringFunctionString
      }
      return oldCall.call(oldToString, this)
    }
    // eslint-disable-next-line
    Function.prototype.toString = functionToString
  })
