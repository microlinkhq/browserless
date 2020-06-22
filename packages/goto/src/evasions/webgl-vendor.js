/**
 * Fix WebGL Vendor/Renderer being set to Google in headless mode
 */
module.exports = page =>
  page.evaluateOnNewDocument(() => {
    try {
      // Remove traces of our Proxy ;-)
      var stripErrorStack = stack =>
        stack
          .split('\n')
          .filter(line => !line.includes('at Object.apply'))
          .filter(line => !line.includes('at Object.get'))
          .join('\n')

      const getParameterProxyHandler = {
        get (target, key) {
          try {
            // Mitigate Chromium bug (#130)
            if (typeof target[key] === 'function') {
              return target[key].bind(target)
            }
            return Reflect.get(target, key)
          } catch (err) {
            err.stack = stripErrorStack(err.stack)
            throw err
          }
        },
        apply: function (target, thisArg, args) {
          const param = (args || [])[0]
          // UNMASKED_VENDOR_WEBGL
          if (param === 37445) {
            return 'Intel Inc.'
          }
          // UNMASKED_RENDERER_WEBGL
          if (param === 37446) {
            return 'Intel(R) Iris(TM) Plus Graphics 640'
          }
          try {
            return Reflect.apply(target, thisArg, args)
          } catch (err) {
            err.stack = stripErrorStack(err.stack)
            throw err
          }
        }
      }

      const proxy = new Proxy(
        window.WebGLRenderingContext.prototype.getParameter,
        getParameterProxyHandler
      )
      // To find out the original values here: Object.getOwnPropertyDescriptors(WebGLRenderingContext.prototype.getParameter)
      Object.defineProperty(window.WebGLRenderingContext.prototype, 'getParameter', {
        configurable: true,
        enumerable: false,
        writable: false,
        value: proxy
      })
    } catch (err) {
      console.warn(err)
    }
  })
