'use strict'

const { isBrowserlessError, ensureError, browserTimeout } = require('@browserless/errors')
const createIsolatedFunction = require('isolated-function')
const requireOneOf = require('require-one-of')
const pTimeout = require('p-timeout')

const { SLOT } = createIsolatedFunction
const createRunFunction = require('./function')
const path = require('path')

// `isolated-function` reads these to know which dependencies a snippet requires
// are already on disk, so it can skip installing them. Walking up from a
// dependency only lands on the consumer's `node_modules` under a flat install:
// with pnpm it lands inside the isolated store, which holds that dependency's
// own dependencies and nothing else, so every snippet paid a fresh install.
// `module.paths` is the resolution chain Node itself would use from here, so it
// reaches the consumer under either layout.
const cloudflareDir = path.dirname(require.resolve('@cloudflare/puppeteer/package.json'))
const nodePaths = [...new Set([path.resolve(cloudflareDir, '..', '..'), ...module.paths])]

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

const isHttpResponse = response => response != null && typeof response.status === 'function'

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

module.exports = ({ tmpdir } = {}) => {
  const isolatedFunction = createIsolatedFunction({ tmpdir, nodePaths })
  const runFunction = createRunFunction(isolatedFunction)

  const toPageValues = extendPage => {
    if (!extendPage) return
    const values = Object.fromEntries(
      Object.entries(extendPage).filter(([, value]) => typeof value !== 'function')
    )
    return Object.keys(values).length ? values : undefined
  }

  const createFunction = (
    fn,
    {
      getBrowserless = requireOneOf(['browserless']),
      retry = 2,
      timeout = 30000,
      gotoOpts,
      extendPage,
      needsBrowser: needsBrowserOverride,
      // False when the caller keeps the context `getBrowserless` created.
      // Destroying or replacing it here would close pages another task still holds.
      // `getPage` does not create a context, so this flag does not apply there.
      ownsContext = true,
      getPage,
      ...opts
    } = {}
  ) => {
    const code = stringify(fn)
    const usesPage = createRunFunction.isUsingPage(code)
    const needsNetwork =
      needsBrowserOverride === true || createRunFunction.needsBrowser(code, extendPage, usesPage)
    const source = createRunFunction.buildTemplate(SLOT, {
      usesPage,
      needsBrowser: needsNetwork,
      extendPage
    })
    const pageValues = toPageValues(extendPage)
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

    // A per-call `code` override is bundled on its own. The template built
    // above only matches the snippet this function was created with.
    const usePrebuiltSource = (runFunctionOpts, network) => {
      if (runFunctionOpts.code !== code) return runFunctionOpts
      runFunctionOpts.needsNetwork = network
      runFunctionOpts.source = source
      return runFunctionOpts
    }

    const buildRunOpts = async ({ page, device, response, url, fnOpts, strictTarget = false }) => {
      if (!page) throw new Error(createRunFunction.PAGE_NOT_FOUND)
      const targetId = await getTargetId(page)
      if (strictTarget && !targetId) throw new Error(createRunFunction.PAGE_NOT_FOUND)

      const browserFromPage = typeof page.browser === 'function' ? page.browser() : undefined
      const browserWSEndpoint =
        browserFromPage && typeof browserFromPage.wsEndpoint === 'function'
          ? browserFromPage.wsEndpoint()
          : undefined

      if (!browserWSEndpoint) throw new Error('Browser WebSocket endpoint not found')

      return usePrebuiltSource(
        {
          url,
          code,
          device,
          extendPage,
          ...opts,
          ...fnOpts,
          ...(pageValues && { pageValues }),
          ...(isHttpResponse(response) && { _response: serializeResponse(response) }),
          browserWSEndpoint,
          targetId,
          ...(strictTarget && { strictTarget: true })
        },
        needsNetwork
      )
    }

    const settle = result => {
      if (result.isFulfilled) return result
      const error = ensureError(result.value)
      if (isBrowserlessError(error)) throw error
      return result
    }

    // The page was navigated by whoever handed it over, so there is no `goto`
    // and no page to close: its owner decides when it dies. `timeout` is not
    // forwarded to `runFunction`, so this path has to apply it itself. A
    // timeout rejects the call and leaves the page open; it does not cancel
    // the snippet.
    const runWithGivenPage = async (url, fnOpts) => {
      const run = async () => {
        const { page, device, response } = await getPage()
        const result = await runFunction(
          await buildRunOpts({ page, device, response, url, fnOpts, strictTarget: true })
        )
        // A miss inside the isolate comes back as a rejected result. It is not
        // a user-code failure: the supplied page was never found.
        if (
          !result.isFulfilled &&
          ensureError(result.value).message === createRunFunction.PAGE_NOT_FOUND
        ) {
          throw new Error(createRunFunction.PAGE_NOT_FOUND)
        }
        return settle(result)
      }

      return pTimeout(run(), timeout, () => {
        throw browserTimeout({ timeout })
      })
    }

    const runWithBrowser = async (url, fnOpts) => {
      const browser = await getBrowser()
      const browserless = await browser.createContext()

      return browserless
        .withPage(
          (page, goto) => async () => {
            const { device, response } = await goto(page, { url, timeout, ...gotoOpts })
            return settle(
              await runFunction(await buildRunOpts({ page, device, response, url, fnOpts }))
            )
          },
          { preserveContext: !ownsContext }
        )()
        .finally(() => {
          if (ownsContext) return browserless.destroyContext()
        })
    }

    const runWithoutBrowser = async (url, fnOpts) => {
      const result = await runFunction(
        usePrebuiltSource(
          {
            url,
            code,
            extendPage,
            ...opts,
            ...fnOpts,
            ...(pageValues && { pageValues })
          },
          false
        )
      )
      return settle(result)
    }

    return async (url, fnOpts = {}) => {
      if (!needsNetwork) return runWithoutBrowser(url, fnOpts)
      return getPage ? runWithGivenPage(url, fnOpts) : runWithBrowser(url, fnOpts)
    }
  }

  createFunction.teardown = () => isolatedFunction.teardown()
  createFunction.shells = isolatedFunction.shells

  return createFunction
}

module.exports.isHttpResponse = isHttpResponse
module.exports.serializeResponse = serializeResponse
module.exports.inspect = createRunFunction.inspect
