'use strict'

const { shallowEqualObjects } = require('shallow-equal')
const { setTimeout } = require('node:timers/promises')
const createDevices = require('@browserless/devices')
const toughCookie = require('tough-cookie')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const isUrl = require('is-url-http')

const { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } = require('puppeteer')

const adblock = require('./adblock')

const debug = require('debug-logfmt')('browserless:goto')
debug.continue = require('debug-logfmt')('browserless:goto:continue')
debug.abort = require('debug-logfmt')('browserless:goto:abort')

const truncate = (str, n = 80) => (str.length > n ? str.substr(0, n - 1) + '…' : str)

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const castArray = value => [].concat(value).filter(Boolean)

const getDefaultPath = pathname => {
  if (!pathname || pathname[0] !== '/') return '/'
  if (pathname === '/') return '/'

  const rightSlash = pathname.lastIndexOf('/')
  return rightSlash === 0 ? '/' : pathname.slice(0, rightSlash)
}

const parseCookiesWithJar = (url, str) => {
  const jar = new toughCookie.CookieJar(undefined, { rejectPublicSuffixes: false })

  return str.split(';').reduce((acc, cookieStr) => {
    const cookie = jar.setCookieSync(cookieStr.trim(), url)
    if (!cookie) return acc
    const parsedCookie = cookie.toJSON()

    parsedCookie.name = parsedCookie.key
    delete parsedCookie.key

    if (parsedCookie.expires) {
      parsedCookie.expires = Math.floor(new Date(parsedCookie.expires) / 1000)
    }

    acc.push(parsedCookie)
    return acc
  }, [])
}

const run = async ({ fn, timeout, debug: props }) => {
  const duration = debug.duration()
  const result = await pReflect(timeout ? pTimeout(fn, timeout) : fn)
  const errorProps = result.isRejected ? { error: result.reason.message || result.reason } : {}
  duration(props, errorProps)
  return result
}

const stopLoadingOnTimeout = (page, timeout) => {
  let timeoutId

  return {
    promise: new Promise(resolve => {
      timeoutId = globalThis.setTimeout(() => {
        pReflect(page._client().send('Page.stopLoading')).then(resolve)
      }, timeout)

      if (typeof timeoutId.unref === 'function') timeoutId.unref()
    }),
    clear: () => {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }
}

const parseCookies = (url, str) => {
  let parsedURL

  try {
    parsedURL = new URL(url)
  } catch {
    return parseCookiesWithJar(url, str)
  }

  const domain = parsedURL.hostname

  if (!domain) {
    return parseCookiesWithJar(url, str)
  }

  const path = getDefaultPath(parsedURL.pathname)
  const chunks = str.split(';')
  const cookies = new Array(chunks.length)
  let index = 0

  for (const chunk of chunks) {
    const cookieStr = chunk.trim()

    if (cookieStr.length === 0) {
      return parseCookiesWithJar(url, str)
    }

    const separatorIndex = cookieStr.indexOf('=')

    if (separatorIndex === -1) {
      return parseCookiesWithJar(url, str)
    }

    const name = cookieStr.slice(0, separatorIndex).trim()

    if (name.length === 0) {
      return parseCookiesWithJar(url, str)
    }

    cookies[index++] = {
      name,
      value: cookieStr.slice(separatorIndex + 1).trim(),
      domain,
      path
    }
  }

  return cookies
}

const getMediaFeatures = ({ animations, colorScheme }) => {
  const prefers = []
  if (animations === false) prefers.push({ name: 'prefers-reduced-motion', value: 'reduce' })
  if (colorScheme) prefers.push({ name: 'prefers-color-scheme', value: colorScheme })
  return prefers
}

const injectScript = (page, value, attributes) =>
  page.addScriptTag({
    [getInjectKey('js', value)]: value,
    ...attributes
  })

const injectStyle = (page, style) =>
  page.addStyleTag({
    [getInjectKey('css', style)]: style
  })

const getInjectKey = (ext, value) =>
  isUrl(value) ? 'url' : value.endsWith(`.${ext}`) ? 'path' : 'content'

const disableAnimations = `
  *,
  ::before,
  ::after {
    animation-delay: 0s !important;
    transition-delay: 0s !important;
    animation-duration: 0s !important;
    transition-duration: 0s !important;
    transition-property: none !important;
  }
`.trim()

const inject = async (page, { timeout, mediaType, animations, modules, scripts, styles }) => {
  const postPromises = []

  if (mediaType) {
    postPromises.push(
      run({
        fn: page.emulateMediaType(mediaType),
        timeout,
        debug: { mediaType }
      })
    )
  }

  if (animations === false) {
    postPromises.push(
      run({
        fn: injectStyle(page, disableAnimations),
        timeout,
        debug: 'disableAnimations'
      })
    )
  }

  if (modules) {
    postPromises.push(
      run({
        fn: Promise.all(
          castArray(modules).map(value => injectScript(page, value, { type: 'module' }))
        ),
        timeout,
        debug: 'modules'
      })
    )
  }

  if (scripts) {
    postPromises.push(
      run({
        fn: Promise.all(castArray(scripts).map(value => injectScript(page, value))),
        timeout,
        debug: 'scripts'
      })
    )
  }

  if (styles) {
    postPromises.push(
      run({
        fn: Promise.all(castArray(styles).map(style => injectStyle(page, style))),
        timeout,
        debug: 'styles'
      })
    )
  }

  return Promise.all(postPromises)
}

module.exports = ({ defaultDevice = 'Macbook Pro 13', timeout: globalTimeout, ...deviceOpts }) => {
  const getDevice = createDevices(deviceOpts)
  const { viewport: defaultViewport } = getDevice.findDevice(defaultDevice)

  const timeouts = {
    base: (milliseconds = globalTimeout) => Math.round(milliseconds * (2 / 3)),
    action: (milliseconds = globalTimeout) => Math.round(milliseconds * (1 / 11)),
    goto: (milliseconds = globalTimeout) => Math.round(milliseconds * (7 / 8))
  }

  // related https://github.com/puppeteer/puppeteer/issues/1353
  const _waitUntilAuto = (page, { timeout }) => {
    return Promise.all(
      [
        {
          fn: () => page.waitForNavigation({ waitUntil: 'networkidle2' }),
          debug: 'waitUntilAuto:waitForNavigation'
        },
        {
          fn: () => page.evaluate(() => window.history.pushState(null, null, null)),
          debug: 'waitUntilAuto:pushState'
        }
      ].map(({ fn, debug }) => run({ fn: fn(), debug, timeout }))
    )
  }

  const goto = async (
    page,
    {
      abortTypes = [],
      adblock: withAdblock = true,
      animations = false,
      authenticate,
      click,
      colorScheme,
      headers = {},
      html,
      javascript = true,
      mediaType,
      modules,
      scripts,
      scroll,
      styles,
      timeout,
      timezone,
      url,
      waitForFunction,
      waitForSelector,
      waitForTimeout,
      waitUntil = 'auto',
      waitUntilAuto = _waitUntilAuto,
      onPageRequest,
      ...args
    }
  ) => {
    const baseTimeout = timeouts.base(timeout || globalTimeout)
    const actionTimeout = timeouts.action(baseTimeout)
    const gotoTimeout = timeouts.goto(baseTimeout)

    const isWaitUntilAuto = waitUntil === 'auto'
    if (isWaitUntilAuto) waitUntil = 'load'

    const prePromises = []

    if (authenticate) {
      prePromises.push(
        run({
          fn: page.authenticate(authenticate),
          timeout: actionTimeout,
          debug: 'authenticate'
        })
      )
    }

    if (modules || scripts || styles) {
      prePromises.push(
        run({
          fn: page.setBypassCSP(true),
          timeout: actionTimeout,
          debug: 'bypassCSP'
        })
      )
    }

    const abortTypesSet = abortTypes.length > 0 ? new Set(abortTypes) : null

    const requestHandlers = []
    let abortTypesHandler
    let disableInterceptionForAbortTypes = false

    if (onPageRequest) {
      const onPageRequestHandler = req => onPageRequest(req, page)
      page.on('request', onPageRequestHandler)
      requestHandlers.push(onPageRequestHandler)
    }

    if (abortTypes.length > 0) {
      abortTypesHandler = req => {
        if (req.isInterceptResolutionHandled()) return
        const resourceType = req.resourceType()
        const url = truncate(req.url())

        if (!abortTypesSet.has(resourceType)) {
          debug.continue({ url, resourceType })
          return req.continue(req.continueRequestOverrides(), DEFAULT_INTERCEPT_RESOLUTION_PRIORITY)
        }
        debug.abort({ url, resourceType })
        return req.abort('blockedbyclient', DEFAULT_INTERCEPT_RESOLUTION_PRIORITY)
      }

      page.on('request', abortTypesHandler)
      requestHandlers.push(abortTypesHandler)
    }

    if (requestHandlers.length > 0) {
      prePromises.push(
        run({
          fn: page.setRequestInterception(true),
          debug: 'enableInterception'
        }).then(result => {
          // If interception setup fails, remove handlers to avoid keeping dead listeners.
          if (result.isRejected) {
            requestHandlers.forEach(handler => page.off('request', handler))
          } else if (abortTypesHandler && !withAdblock && !onPageRequest) {
            disableInterceptionForAbortTypes = true
          }
          return result
        })
      )
    }

    if (withAdblock) {
      prePromises.push(...adblock.enableBlockingInPage(page, run, actionTimeout))
    }

    if (javascript === false) {
      prePromises.push(
        run({
          fn: page.setJavaScriptEnabled(false),
          timeout: actionTimeout,
          debug: { javascript }
        })
      )
    }

    const device = getDevice({
      headers,
      device: args.device ?? defaultDevice,
      viewport: args.viewport
    })

    if (device.userAgent && !headers['user-agent']) {
      headers['user-agent'] = device.userAgent
    }

    if (!isEmpty(device.viewport) && !shallowEqualObjects(defaultViewport, device.viewport)) {
      prePromises.push(
        run({
          fn: page.setViewport(device.viewport),
          timeout: actionTimeout,
          debug: 'viewport'
        })
      )
    }

    const headersKeys = Object.keys(headers)

    if (headersKeys.length > 0) {
      const cookie = headers.cookie
      const userAgent = headers['user-agent']

      if (cookie) {
        const cookies = parseCookies(url, cookie)
        prePromises.push(
          run({
            fn: page.setCookie(...cookies),
            timeout: actionTimeout,
            debug: ['cookies', ...cookies.map(({ name }) => name)]
          })
        )
      }

      if (userAgent) {
        prePromises.push(
          run({
            fn: page.setUserAgent(userAgent),
            timeout: actionTimeout,
            debug: { 'user-agent': userAgent }
          })
        )
      }

      if (cookie) {
        const extraHTTPHeaders = {}
        const extraHTTPHeadersKeys = []

        for (const key of headersKeys) {
          if (key === 'cookie') continue
          extraHTTPHeaders[key] = headers[key]
          extraHTTPHeadersKeys.push(key)
        }

        if (extraHTTPHeadersKeys.length > 0) {
          prePromises.push(
            run({
              fn: page.setExtraHTTPHeaders(extraHTTPHeaders),
              timeout: actionTimeout,
              debug: { headers: extraHTTPHeadersKeys }
            })
          )
        }
      } else if (!(userAgent && headersKeys.length === 1)) {
        prePromises.push(
          run({
            fn: page.setExtraHTTPHeaders(headers),
            timeout: actionTimeout,
            debug: { headers: headersKeys }
          })
        )
      }
    }

    if (timezone) {
      prePromises.push(
        run({
          fn: page.emulateTimezone(timezone),
          timeout: actionTimeout,
          debug: { timezone }
        })
      )
    }

    const mediaFeatures = getMediaFeatures({ animations, colorScheme })

    if (mediaFeatures.length > 0) {
      prePromises.push(
        run({
          fn: page.emulateMediaFeatures(mediaFeatures),
          timeout: actionTimeout,
          debug: { mediaFeatures: mediaFeatures.map(({ name }) => name) }
        })
      )
    }

    try {
      await Promise.all(prePromises)

      let clearStopLoadingTimer = () => {}
      const navigationPromise = html
        ? page.setContent(html, { waitUntil, ...args })
        : (() => {
            const { promise, clear } = stopLoadingOnTimeout(page, gotoTimeout)
            clearStopLoadingTimer = clear
            return Promise.race([page.goto(url, { waitUntil, ...args }), promise])
          })()

      const { value: response, reason: error } = await run({
        fn: navigationPromise,
        timeout: gotoTimeout,
        debug: { fn: html ? 'html' : 'url', waitUntil }
      })
      clearStopLoadingTimer()

      if (withAdblock) {
        await run({
          fn: adblock.runAutoConsent(page),
          timeout: actionTimeout,
          debug: 'autoconsent:run'
        })
      }

      for (const [key, value] of Object.entries({
        waitForSelector,
        waitForFunction
      })) {
        if (value) {
          await run({ fn: page[key](value), timeout: gotoTimeout, debug: { [key]: value } })
        }
      }

      if (waitForTimeout) {
        await setTimeout(waitForTimeout)
      }

      await inject(page, {
        timeout: actionTimeout,
        mediaType,
        animations,
        modules,
        scripts,
        styles
      })

      if (click) {
        for (const selector of castArray(click)) {
          await run({
            fn: page.click(selector),
            timeout: actionTimeout,
            debug: { click: selector }
          })
        }
      }

      if (scroll) {
        await run({
          fn: page.$eval(scroll, el => el.scrollIntoView()),
          timeout: actionTimeout,
          debug: { scroll }
        })
      }

      if (isWaitUntilAuto) {
        await waitUntilAuto(page, { response, timeout: actionTimeout * 2 })
      }

      return { response, device, error }
    } finally {
      if (abortTypesHandler) page.off('request', abortTypesHandler)
      if (disableInterceptionForAbortTypes) {
        await pReflect(page.setRequestInterception(false))
      }
    }
  }

  goto.getDevice = getDevice
  goto.devices = getDevice.devices
  goto.findDevice = getDevice.findDevice
  goto.deviceDescriptors = getDevice.deviceDescriptors
  goto.defaultViewport = defaultViewport
  goto.waitUntilAuto = _waitUntilAuto
  goto.timeouts = timeouts
  goto.run = run

  return goto
}

module.exports.parseCookies = parseCookies
module.exports.inject = inject
