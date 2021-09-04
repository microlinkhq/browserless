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

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const castArray = value => [].concat(value).filter(Boolean)

const getInjectKey = (ext, value) =>
  isUrl(value) ? 'url' : value.endsWith(`.${ext}`) ? 'path' : 'content'

const injectCSS = (page, css) =>
  pReflect(
    page.addStyleTag({
      content: css
    })
  )

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

const injectScripts = (page, values, attributes) =>
  Promise.all(
    castArray(values).map(value =>
      pReflect(
        page.addScriptTag({
          [getInjectKey('js', value)]: value,
          ...attributes
        })
      )
    )
  )

const injectStyles = (page, styles) =>
  Promise.all(
    castArray(styles).map(style =>
      pReflect(
        page.addStyleTag({
          [getInjectKey('css', style)]: style
        })
      )
    )
  )

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

const run = async ({ fn, debug: props }) => {
  const debugProps = { duration: timeSpan() }
  const result = await pReflect(fn)
  debugProps.duration = prettyMs(debugProps.duration())
  if (result.isRejected) debugProps.error = result.reason.message || result.reason
  debug(props, debugProps)
  return result
}

// related https://github.com/puppeteer/puppeteer/issues/1353
const createWaitUntilAuto = defaultOpts => (page, opts) => {
  const { timeout } = { ...defaultOpts, ...opts }

  return run({
    fn: pTimeout(
      Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.evaluate(() => window.history.pushState(null, null, null))
      ]),
      timeout * (1 / 8)
    ),
    debug: { isWaitUntilAuto: true }
  })
}

module.exports = ({
  evasions = ALL_EVASIONS_KEYS,
  defaultDevice = 'Macbook Pro 13',
  timeout: globalTimeout,
  ...deviceOpts
}) => {
  const baseTimeout = globalTimeout * (1 / 2)
  const getDevice = createDevices(deviceOpts)
  const { viewport: defaultViewport } = getDevice.findDevice(defaultDevice)

  const applyEvasions = castArray(evasions)
    .filter(Boolean)
    .reduce((acc, key) => [...acc, EVASIONS[key]], [])

  const _waitUntilAuto = createWaitUntilAuto({ timeout: baseTimeout })

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

    if (adblock) {
      prePromises.push(engine.enableBlockingInPage(page))
    }

    if (javascript === false) {
      prePromises.push(
        run({
          fn: page.setJavaScriptEnabled(false),
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
            debug: ['cookies', ...cookies.map(({ name }) => name)]
          })
        )
      }

      if (headers['user-agent']) {
        prePromises.push(
          run({
            fn: page.setUserAgent(headers['user-agent']),
            debug: { 'user-agent': headers['user-agent'] }
          })
        )
      }

      prePromises.push(
        run({
          fn: page.setExtraHTTPHeaders(headers),
          debug: { headers: headersKeys }
        })
      )
    }

    if (mediaType) {
      prePromises.push(
        run({
          fn: page.emulateMediaType(mediaType),
          debug: { mediaType }
        })
      )
    }

    if (timezone) {
      prePromises.push(
        run({
          fn: page.emulateTimezone(timezone),
          debug: { timezone }
        })
      )
    }

    const mediaFeatures = getMediaFeatures({ animations, colorScheme })

    if (mediaFeatures.length > 0) {
      prePromises.push(
        run({
          fn: page.emulateMediaFeatures(mediaFeatures),
          debug: { mediaFeatures: mediaFeatures.length }
        })
      )
    }

    await Promise.all(prePromises.concat(applyEvasions.map(fn => fn(page))))

    if (abortTypes.length > 0) {
      page.on('request', req => {
        const resourceType = req.resourceType()
        if (!abortTypes.includes(resourceType)) return req.continue()
        debug('abort', { url: req.url(), resourceType })
        return req.abort('blockedbyclient')
      })
    }

    const { value } = await run({
      fn: pTimeout(html ? page.setContent(html, args) : page.goto(url, args), timeout),
      debug: html ? 'html' : 'url'
    })

    for (const [key, value] of Object.entries({
      waitForSelector,
      waitForXPath,
      waitForFunction,
      waitForTimeout
    })) {
      if (value) await run({ fn: page[key](value), debug: { [key]: value } })
    }

    const postPromises = []

    if (animations === false) {
      postPromises.push(injectCSS(page, disableAnimations))
    }

    const hideOrRemove = [
      hide && injectCSS(page, `${castArray(hide).join(', ')} { visibility: hidden !important; }`),
      remove && injectCSS(page, `${castArray(remove).join(', ')} { display: none !important; }`)
    ].filter(Boolean)

    if (hideOrRemove.length > 0) {
      postPromises.push(
        run({
          fn: Promise.all(hideOrRemove),
          debug: { hideOrRemove: hideOrRemove.length }
        })
      )
    }

    const injections = [
      modules && injectScripts(page, modules, { type: 'modules' }),
      scripts && injectScripts(page, scripts),
      styles && injectStyles(page, styles)
    ].filter(Boolean)

    if (injections.length > 0) {
      postPromises.push(
        run({
          fn: Promise.all(injections),
          debug: { injections: injections.length }
        })
      )
    }

    await Promise.all(postPromises)

    if (click) {
      for (const selector of castArray(click)) {
        await run({ fn: page.click(selector), debug: { click: selector } })
      }
    }

    if (scroll) {
      await run({
        fn: page.$eval(scroll, el => el.scrollIntoView()),
        debug: { scroll }
      })
    }

    if (isWaitUntilAuto) await waitUntilAuto(page, { response: value, timeout })

    return { response: value, device }
  }

  goto.getDevice = getDevice
  goto.devices = getDevice.devices
  goto.findDevice = getDevice.findDevice
  goto.deviceDescriptors = getDevice.deviceDescriptors
  goto.defaultViewport = defaultViewport
  goto.waitUntilAuto = _waitUntilAuto
  goto.timeout = baseTimeout

  return goto
}

module.exports.parseCookies = parseCookies
module.exports.injectScripts = injectScripts
module.exports.injectStyles = injectStyles
module.exports.evasions = ALL_EVASIONS_KEYS
