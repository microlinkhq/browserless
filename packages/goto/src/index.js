'use strict'

const debugAdblock = require('debug-logfmt')('browserless:goto:adblock')
const { PuppeteerBlocker } = require('@cliqz/adblocker-puppeteer')
const debug = require('debug-logfmt')('browserless:goto')
const { shallowEqualObjects } = require('shallow-equal')
const createDevices = require('@browserless/devices')
const toughCookie = require('tough-cookie')
const prettyMs = require('pretty-ms')
const pReflect = require('p-reflect')
const timeSpan = require('time-span')
const pTimeout = require('p-timeout')
const isUrl = require('is-url-http')
const path = require('path')
const fs = require('fs')

const EVASIONS = require('./evasions')

const ALL_EVASIONS_KEYS = Object.keys(EVASIONS)

const engine = PuppeteerBlocker.deserialize(
  new Uint8Array(fs.readFileSync(path.resolve(__dirname, './engine.bin')))
)

engine.on('request-blocked', ({ url }) => debugAdblock('block', url))
engine.on('request-redirected', ({ url }) => debugAdblock('redirect', url))
engine.setRequestInterceptionPriority(1)

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const castArray = value => [].concat(value).filter(Boolean)

const run = async ({ fn, timeout, debug: props }) => {
  const debugProps = { duration: timeSpan() }
  const result = await pReflect(pTimeout(fn, timeout))
  debugProps.duration = prettyMs(debugProps.duration())
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

    return [...acc, parsedCookie]
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

// related https://github.com/puppeteer/puppeteer/issues/1353
const createWaitUntilAuto = defaultOpts => (page, opts) => {
  const { timeout } = { ...defaultOpts, ...opts }

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
    ].map(({ fn, ...opts }) => run({ fn: fn(), timeout, ...opts }))
  )
}

module.exports = ({
  evasions = ALL_EVASIONS_KEYS,
  defaultDevice = 'Macbook Pro 13',
  timeout: globalTimeout,
  ...deviceOpts
}) => {
  const baseTimeout = globalTimeout * (1 / 2)
  const actionTimeout = baseTimeout * (1 / 8)

  const getDevice = createDevices(deviceOpts)
  const { viewport: defaultViewport } = getDevice.findDevice(defaultDevice)

  const _waitUntilAuto = createWaitUntilAuto({ timeout: actionTimeout })

  const goto = async (
    page,
    {
      abortTypes = [],
      adblock = true,
      animations = false,
      click,
      colorScheme,
      headers = {},
      hide,
      html,
      javascript = true,
      mediaType,
      modules,
      remove,
      scripts,
      scroll,
      styles,
      timeout = baseTimeout,
      timezone,
      url,
      waitForFunction,
      waitForSelector,
      waitForTimeout,
      waitForXPath,
      waitUntil = 'auto',
      waitUntilAuto = _waitUntilAuto,
      ...args
    }
  ) => {
    const isWaitUntilAuto = waitUntil === 'auto'
    if (isWaitUntilAuto) waitUntil = 'load'

    const prePromises = []

    if (abortTypes.length > 0) {
      await page.setRequestInterception(true)
      page.on('request', req => {
        const resourceType = req.resourceType()
        if (!abortTypes.includes(resourceType)) {
          debug('continue', { url: req.url(), resourceType })
          return req.continue(req.continueRequestOverrides(), 2)
        }
        debug('abort', { url: req.url(), resourceType })
        return req.abort('blockedbyclient', 2)
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

    const device = getDevice({ headers, ...args })

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

    const applyEvasions = castArray(evasions)
      .filter(Boolean)
      .map(key =>
        run({
          fn: EVASIONS[key](page),
          timeout: actionTimeout,
          debug: key
        })
      )

    await Promise.all(prePromises.concat(applyEvasions))

    const { value } = await run({
      fn: html ? page.setContent(html, args) : page.goto(url, args),
      timeout,
      debug: html ? 'html' : 'url'
    })

    for (const [key, value] of Object.entries({
      waitForSelector,
      waitForXPath,
      waitForFunction,
      waitForTimeout
    })) {
      if (value) {
        await run({ fn: page[key](value), timeout: actionTimeout, debug: { [key]: value } })
      }
    }

    const postPromises = []

    if (mediaType) {
      postPromises.push(
        run({
          fn: page.emulateMediaType(mediaType),
          timeout: actionTimeout,
          debug: { mediaType }
        })
      )
    }

    if (animations === false) {
      postPromises.push(
        run({
          fn: injectStyle(page, disableAnimations),
          timeout: actionTimeout,
          debug: 'disableAnimations'
        })
      )
    }

    if (hide) {
      postPromises.push(
        run({
          fn: injectStyle(page, `${castArray(hide).join(', ')} { visibility: hidden !important; }`),
          timeout: actionTimeout,
          debug: 'hide'
        })
      )
    }

    if (remove) {
      postPromises.push(
        run({
          fn: injectStyle(page, `${castArray(remove).join(', ')} { display: none !important; }`),
          timeout: actionTimeout,
          debug: 'remove'
        })
      )
    }

    if (modules) {
      postPromises.push(
        run({
          fn: Promise.all(
            castArray(modules).map(value => injectScript(page, value, { type: 'modules' }))
          ),
          timeout: actionTimeout,
          debug: 'modules'
        })
      )
    }

    if (scripts) {
      postPromises.push(
        run({
          fn: Promise.all(castArray(scripts).map(value => injectScript(page, value))),
          timeout: actionTimeout,
          debug: 'scripts'
        })
      )
    }

    if (styles) {
      postPromises.push(
        run({
          fn: Promise.all(castArray(styles).map(style => injectStyle(page, style))),
          timeout: actionTimeout,
          debug: 'styles'
        })
      )
    }

    await Promise.all(postPromises)

    if (click) {
      for (const selector of castArray(click)) {
        await run({ fn: page.click(selector), timeout: actionTimeout, debug: { click: selector } })
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
      await waitUntilAuto(page, { response: value, timeout: actionTimeout * 2 })
    }

    return { response: value, device }
  }

  goto.getDevice = getDevice
  goto.devices = getDevice.devices
  goto.findDevice = getDevice.findDevice
  goto.deviceDescriptors = getDevice.deviceDescriptors
  goto.defaultViewport = defaultViewport
  goto.waitUntilAuto = _waitUntilAuto
  goto.timeout = baseTimeout
  goto.actionTimeout = actionTimeout
  goto.run = run

  return goto
}

module.exports.parseCookies = parseCookies
module.exports.injectScript = injectScript
module.exports.injectStyle = injectStyle
module.exports.evasions = ALL_EVASIONS_KEYS
