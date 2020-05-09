'use strict'

const debugAdblock = require('debug-logfmt')('browserless:goto:adblock')
const { PuppeteerBlocker } = require('@cliqz/adblocker-puppeteer')
const debug = require('debug-logfmt')('browserless:goto')
const { shallowEqualObjects } = require('shallow-equal')
const createDevices = require('@browserless/devices')
const { getDomain } = require('tldts')
const prettyMs = require('pretty-ms')
const pReflect = require('p-reflect')
const timeSpan = require('time-span')
const pTimeout = require('p-timeout')
const isUrl = require('is-url-http')
const path = require('path')
const fs = require('fs')

const engine = PuppeteerBlocker.deserialize(
  new Uint8Array(fs.readFileSync(path.resolve(__dirname, './engine.bin')))
)

engine.on('request-blocked', ({ url }) => debugAdblock('block', url))
engine.on('request-redirected', ({ url }) => debugAdblock('redirect', url))

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const toArray = value => [].concat(value)

const getInjectKey = (ext, value) =>
  isUrl(value) ? 'url' : value.endsWith(`.${ext}`) ? 'path' : 'content'

const injectCSS = (page, css) =>
  pReflect(
    page.addStyleTag({
      content: css
    })
  )

const scrollTo = (element, options) => {
  const isOverflown = element => {
    return element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth
  }

  const findScrollParent = element => {
    if (element === undefined) {
      return
    }

    if (isOverflown(element)) {
      return element
    }

    return findScrollParent(element.parentElement)
  }

  const calculateOffset = (rect, options) => {
    if (options === undefined) {
      return {
        x: rect.left,
        y: rect.top
      }
    }

    const offset = options.offset || 0

    switch (options.offsetFrom) {
      case 'top':
        return {
          x: rect.left,
          y: rect.top + offset
        }
      case 'right':
        return {
          x: rect.left - offset,
          y: rect.top
        }
      case 'bottom':
        return {
          x: rect.left,
          y: rect.top - offset
        }
      case 'left':
        return {
          x: rect.left + offset,
          y: rect.top
        }
      default:
        throw new Error('Invalid `scroll.offsetFrom` value')
    }
  }

  const rect = element.getBoundingClientRect()
  const offset = calculateOffset(rect, options)
  const parent = findScrollParent(element)

  if (parent !== undefined) {
    parent.scroll(offset.x, offset.y)
  }
}

const parseCookies = (url, str) => {
  const domain = `.${getDomain(url)}`
  return str.split(';').reduce((acc, str) => {
    const [name, value] = str.split('=')
    const cookie = {
      name: name.trim(),
      value,
      domain,
      url,
      path: '/'
    }
    return [...acc, cookie]
  }, [])
}

const getMediaFeatures = ({ animations, colorScheme }) => {
  const prefers = []
  if (animations === false) prefers.push({ name: 'prefers-reduced-motion', value: 'reduce' })
  if (colorScheme) prefers.push({ name: 'prefers-color-scheme', value: colorScheme })
  return prefers
}

const injectScripts = (page, values, attributes) =>
  Promise.all(
    toArray(values).map(value =>
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
    toArray(styles).map(style =>
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

module.exports = ({ defaultDevice = 'Macbook Pro 13', timeout, ...deviceOpts }) => {
  const gotoTimeout = timeout * (1 / 2)
  const getDevice = createDevices(deviceOpts)
  const { viewport: defaultViewport } = getDevice.findDevice(defaultDevice)

  const goto = async (
    page,
    {
      url,
      mediaType,
      adblock = true,
      headers = {},
      waitFor = 0,
      animations = false,
      javascript = true,
      colorScheme,
      waitUntil,
      hide,
      remove,
      click,
      modules,
      scripts,
      styles,
      scroll,
      ...args
    }
  ) => {
    const isWaitUntilAuto = waitUntil === 'auto'

    if (isWaitUntilAuto) {
      waitUntil = 'load'
    }

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

    if (Object.keys(headers).length > 0) {
      prePromises.push(
        run({
          fn: page.setExtraHTTPHeaders(headers),
          debug: { headers: Object.keys(headers).length }
        })
      )
    }

    if (typeof headers.cookie === 'string') {
      const cookies = parseCookies(url, headers.cookie)
      prePromises.push(
        run({
          fn: page.setCookie(...cookies),
          debug: ['cookies', ...cookies]
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

    const mediaFeatures = getMediaFeatures({ animations, colorScheme })

    if (mediaFeatures.length > 0) {
      prePromises.push(
        run({
          fn: page.emulateMediaFeatures(mediaFeatures),
          debug: { mediaFeatures: mediaFeatures.length }
        })
      )
    }

    await Promise.all(prePromises)

    const { isFulfilled, value: response } = await run({
      fn: pTimeout(page.goto(url, args), gotoTimeout),
      debug: 'goto'
    })

    if (isFulfilled) {
      const postPromises = []

      if (waitFor) {
        await run({ fn: page.waitFor(waitFor), debug: { waitFor } })
      }

      if (animations === false) {
        postPromises.push(injectCSS(page, disableAnimations))
      }

      const hideOrRemove = [
        hide && injectCSS(page, `${toArray(hide).join(', ')} { visibility: hidden !important; }`),
        remove && injectCSS(page, `${toArray(remove).join(', ')} { display: none !important; }`)
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
        for (const selector of toArray(click)) {
          await run({ fn: page.click(selector), debug: { click: selector } })
        }
      }

      if (scroll) {
        if (typeof scroll === 'object') {
          await run({ fn: page.$eval(scroll.element, scrollTo, scroll), debug: { scroll } })
        } else {
          await run({ fn: page.$eval(scroll, scrollTo), debug: { scroll } })
        }
      }
    }

    if (isWaitUntilAuto) {
      await run({
        fn: pTimeout(
          Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.evaluate(() => window.history.pushState(null, null, '#'))
          ]),
          gotoTimeout * (1 / 3)
        ),
        debug: { isWaitUntilAuto }
      })
    }

    return { response, device }
  }

  goto.getDevice = getDevice
  goto.devices = getDevice.devices
  goto.findDevice = getDevice.findDevice
  goto.deviceDescriptors = getDevice.deviceDescriptors
  goto.defaultViewport = defaultViewport

  return goto
}

module.exports.parseCookies = parseCookies
module.exports.injectScripts = injectScripts
module.exports.injectStyles = injectStyles
