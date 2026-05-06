'use strict'

const { isBrowserlessError, ensureError } = require('@browserless/errors')
const requireOneOf = require('require-one-of')
const runFunction = require('./function')

const stringify = fn => fn.toString().trim().replace(/;$/, '')

const getTargetId = async page => {
  try {
    const session = await page.createCDPSession()
    const { targetInfo } = await session.send('Target.getTargetInfo')
    await session.detach()
    return targetInfo.targetId
  } catch {
    return undefined
  }
}

const serializeResponse = response => ({
  status: response.status(),
  statusText: response.statusText(),
  url: response.url(),
  ok: response.ok(),
  headers: response.headers(),
  remoteAddress: response.remoteAddress(),
  timing: response.timing(),
  fromCache: response.fromCache(),
  fromServiceWorker: response.fromServiceWorker()
})

module.exports = (
  fn,
  {
    getBrowserless = requireOneOf(['browserless']),
    retry = 2,
    timeout = 30000,
    gotoOpts,
    ...opts
  } = {}
) => {
  const code = stringify(fn)
  const needsNetwork = runFunction.isUsingPage(code)
  const source = runFunction.buildTemplate(code, needsNetwork)
  let browserPromise

  const getBrowser = async () => {
    if (!browserPromise) {
      browserPromise = Promise.resolve(getBrowserless()).catch(error => {
        browserPromise = undefined
        throw error
      })
    }
    return browserPromise
  }

  return async (url, fnOpts = {}) => {
    const browser = await getBrowser()
    const browserless = await browser.createContext()

    return browserless.withPage((page, goto) => async () => {
      const { device, response } = await goto(page, { url, timeout, ...gotoOpts })

      const targetId = await getTargetId(page)

      const runFunctionOpts = {
        url,
        code,
        device,
        ...opts,
        ...fnOpts,
        ...(response && { _response: serializeResponse(response) })
      }

      if (runFunctionOpts.code === code) {
        runFunctionOpts.needsNetwork = needsNetwork
        runFunctionOpts.source = source
      }

      if (runFunctionOpts.needsNetwork !== false) {
        const browserFromPage = typeof page.browser === 'function' ? page.browser() : undefined
        const browserWSEndpoint =
          browserFromPage && typeof browserFromPage.wsEndpoint === 'function'
            ? browserFromPage.wsEndpoint()
            : undefined

        if (!browserWSEndpoint) throw new Error('Browser WebSocket endpoint not found')
        runFunctionOpts.browserWSEndpoint = browserWSEndpoint
        runFunctionOpts.targetId = targetId
      }

      const result = await runFunction(runFunctionOpts)

      if (result.isFulfilled) return result
      const error = ensureError(result.value)
      if (isBrowserlessError(error)) throw error
      return result
    })()
  }
}
