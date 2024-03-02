'use strict'

const { PuppeteerBlocker } = require('@cliqz/adblocker-puppeteer')
const { shallowEqualObjects } = require('shallow-equal')
const { setTimeout } = require('node:timers/promises')
const createDevices = require('@browserless/devices')
const toughCookie = require('tough-cookie')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const isUrl = require('is-url-http')
const path = require('path')
const fs = require('fs')

const timeSpan = require('@kikobeats/time-span')({ format: require('pretty-ms') })

const { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } = require('puppeteer')

const debug = require('debug-logfmt')('browserless:goto')
debug.continue = require('debug-logfmt')('browserless:goto:continue')
debug.abort = require('debug-logfmt')('browserless:goto:abort')
debug.adblock = require('debug-logfmt')('browserless:goto:adblock')

const truncate = (str, n = 80) => (str.length > n ? str.substr(0, n - 1) + '…' : str)

const engine = PuppeteerBlocker.deserialize(
  new Uint8Array(fs.readFileSync(path.resolve(__dirname, './engine.bin')))
)

engine.on('request-blocked', ({ url }) => debug.adblock('block', url))
engine.on('request-redirected', ({ url }) => debug.adblock('redirect', url))

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const castArray = value => [].concat(value).filter(Boolean)

const run = async ({ fn, timeout, debug: props }) => {
  const debugProps = { duration: timeSpan() }
  const result = await pReflect(timeout ? pTimeout(fn, timeout) : fn)
  debugProps.duration = debugProps.duration()
  if (result.isRejected) debugProps.error = result.reason.message || result.reason
  debug(props, debugProps)
  return result
}

const parseCookies = (url, str) =>
  str.split(';').reduce((acc, cookieStr) => {
    const jar = new toughCookie.CookieJar(undefined, { rejectPublicSuffixes: false })
    jar.setCookieSync(cookieStr.trim(), url)
    const parsedCookie = jar.serializeSync().cookies[0]

    // Use this instead of the above when the following issue is fixed:
    // https://github.com/salesforce/tough-cookie/issues/149
    // const ret = toughCookie.parse(cookie).serializeSync();

    parsedCookie.name = parsedCookie.key
    delete parsedCookie.key

    if (parsedCookie.expires) {
      parsedCookie.expires = Math.floor(new Date(parsedCookie.expires) / 1000)
    }

    acc.push(parsedCookie)
    return acc
  }, [])

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
    base: (milliseconds = globalTimeout) => milliseconds * (2 / 3),
    action: (milliseconds = globalTimeout) => milliseconds * (1 / 11),
    goto: (milliseconds = globalTimeout) => milliseconds * (7 / 8)
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
      adblock = true,
      animations = false,
      click,
      colorScheme,
      headers = {},
      html,
      javascript = true,
      mediaType,
      modules,
      password,
      scripts,
      scroll,
      styles,
      timeout = globalTimeout,
      timezone,
      url,
      username,
      waitForFunction,
      waitForSelector,
      waitForTimeout,
      waitUntil = 'auto',
      waitUntilAuto = _waitUntilAuto,
      onPageRequest,
      ...args
    }
  ) => {
    const baseTimeout = timeouts.base(globalTimeout)
    const actionTimeout = timeouts.action(baseTimeout)
    const gotoTimeout = timeouts.goto(baseTimeout)

    const isWaitUntilAuto = waitUntil === 'auto'
    if (isWaitUntilAuto) waitUntil = 'load'

    const prePromises = []

    if (username || password) {
      prePromises.push(
        run({
          fn: page.authenticate({ username, password }),
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

    const enableInterception =
      (onPageRequest || abortTypes.length > 0) &&
      run({ fn: page.setRequestInterception(true), debug: 'enableInterception' })

    if (onPageRequest) {
      Promise.resolve(enableInterception).then(() => page.on('request', onPageRequest))
    }

    if (abortTypes.length > 0) {
      Promise.resolve(enableInterception).then(() => {
        page.on('request', req => {
          if (req.isInterceptResolutionHandled()) return
          const resourceType = req.resourceType()
          const url = truncate(req.url())

          if (!abortTypes.includes(resourceType)) {
            debug.continue({ url, resourceType })
            return req.continue(
              req.continueRequestOverrides(),
              DEFAULT_INTERCEPT_RESOLUTION_PRIORITY
            )
          }
          debug.abort({ url, resourceType })
          return req.abort('blockedbyclient', DEFAULT_INTERCEPT_RESOLUTION_PRIORITY)
        })
      })
    }

    if (adblock) {
      prePromises.push(
        run({
          fn: engine.enableBlockingInPage(page),
          timeout: actionTimeout,
          debug: 'adblock'
        })
      )
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

    const device = getDevice({ headers, ...args, device: args.device ?? defaultDevice })

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
      if (headers.cookie) {
        const cookies = parseCookies(url, headers.cookie)
        prePromises.push(
          run({
            fn: page.setCookie(...cookies),
            timeout: actionTimeout,
            debug: ['cookies', ...cookies.map(({ name }) => name)]
          })
        )
      }

      if (headers['user-agent']) {
        prePromises.push(
          run({
            fn: page.setUserAgent(headers['user-agent']),
            timeout: actionTimeout,
            debug: { 'user-agent': headers['user-agent'] }
          })
        )
      }

      prePromises.push(
        run({
          fn: page.setExtraHTTPHeaders(headers),
          timeout: actionTimeout,
          debug: { headers: headersKeys }
        })
      )
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

    await Promise.all(prePromises)

    const { value: response, reason: error } = await run({
      fn: html
        ? page.setContent(html, { waitUntil, ...args })
        : page.goto(url, { waitUntil, ...args }),
      timeout: gotoTimeout,
      debug: { fn: html ? 'html' : 'url', waitUntil }
    })

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
