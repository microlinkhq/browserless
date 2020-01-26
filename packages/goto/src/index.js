'use strict'

const { PuppeteerBlocker } = require('@cliqz/adblocker-puppeteer')
const debug = require('debug-logfmt')('browserless:goto')
const createDevices = require('@browserless/devices')
const { getDomain } = require('tldts')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const path = require('path')
const fs = require('fs')

const engine = PuppeteerBlocker.deserialize(
  new Uint8Array(fs.readFileSync(path.resolve(__dirname, './engine.bin')))
)

engine.on('request-blocked', ({ url }) => debug('adblock:block', url))
engine.on('request-redirected', ({ url }) => debug('adblock:redirect', url))

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const toArray = value => [].concat(value)

const isUrl = string => /^(https?|file):\/\/|^data:/.test(string)

const getInjectKey = (ext, value) =>
  isUrl(value) ? 'url' : value.endsWith(`.${ext}`) ? 'path' : 'content'

const hideElements = elements => {
  for (const element of elements) {
    if (element) element.style.visibility = 'hidden'
  }
}

const removeElements = elements => {
  for (const element of elements) {
    element.style.display = 'none'
  }
}

const scrollToElement = (element, options) => {
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
        throw new Error('Invalid `scrollToElement.offsetFrom` value')
    }
  }

  const rect = element.getBoundingClientRect()
  const offset = calculateOffset(rect, options)
  const parent = findScrollParent(element)

  if (parent !== undefined) {
    parent.scrollTo(offset.x, offset.y)
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

const disableAnimations = () => {
  const rule = `
  *,
  ::before,
  ::after {
    animation-delay: 0s !important;
    transition-delay: 0s !important;
    animation-duration: 0s !important;
    transition-duration: 0s !important;
    transition-property: none !important;
  }
`
  const style = document.createElement('style')
  if (document.body) document.body.append(style)
  if (style.sheet) style.sheet.insertRule(rule)
}

module.exports = ({ timeout, ...deviceOpts }) => {
  const gotoTimeout = timeout * (1 / 4)
  const getDevice = createDevices(deviceOpts)

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
      hide,
      remove,
      click,
      modules,
      scripts,
      styles,
      scrollTo,
      ...args
    }
  ) => {
    if (adblock) {
      debug({ adblock })
      await engine.enableBlockingInPage(page)
    }

    if (javascript === false) {
      debug({ javascript })
      await page.setJavaScriptEnabled(false)
    }

    if (Object.keys(headers).length !== 0) {
      debug('headers', headers)
      await page.setExtraHTTPHeaders(headers)
    }

    if (typeof headers.cookie === 'string') {
      const cookies = parseCookies(url, headers.cookie)
      debug('cookies', ...cookies)
      await page.setCookie(...cookies)
    }

    const device = getDevice({ headers, ...args })

    if (device.userAgent) {
      debug({ userAgent: device.userAgent })
      await page.setUserAgent(device.userAgent)
    }

    if (!isEmpty(device.viewport)) {
      debug('viewport', device.viewport)
      await page.setViewport(device.viewport)
    }

    if (mediaType) {
      debug({ mediaType })
      await page.emulateMediaType(mediaType)
    }

    const { isFulfilled, value: response } = await pReflect(
      pTimeout(page.goto(url, args), gotoTimeout)
    )

    if (isFulfilled) {
      if (waitFor) {
        debug({ waitFor })
        await page.waitFor(waitFor)
      }

      if (animations === false) {
        debug({ animations })
        await page.evaluate(disableAnimations)
      }

      if (hide) {
        debug({ hide })
        await Promise.all(
          toArray(hide).map(selector => pReflect(page.$$eval(selector, hideElements)))
        )
      }

      if (remove) {
        debug({ remove })
        await Promise.all(
          toArray(remove).map(selector => pReflect(page.$$eval(selector, removeElements)))
        )
      }

      if (click) {
        for (const selector of toArray(click)) {
          debug({ click: selector })
          await pReflect(page.click(selector))
        }
      }

      if (modules) {
        await Promise.all(
          toArray(modules).map(m =>
            pReflect(
              page.addScriptTag({
                [getInjectKey('js', m)]: m,
                type: 'module'
              })
            )
          )
        )
      }

      if (scripts) {
        await Promise.all(
          toArray(scripts).map(script =>
            pReflect(
              page.addScriptTag({
                [getInjectKey('js', script)]: script
              })
            )
          )
        )
      }

      if (styles) {
        await Promise.all(
          toArray(styles).map(style =>
            pReflect(
              page.addStyleTag({
                [getInjectKey('css', style)]: style
              })
            )
          )
        )
      }

      if (scrollTo) {
        debug({ scrollTo })
        if (typeof scrollTo === 'object') {
          await pReflect(page.$eval(scrollTo.element, scrollToElement, scrollTo))
        } else {
          await pReflect(page.$eval(scrollTo, scrollToElement))
        }
      }
    }

    return { response, device }
  }

  goto.getDevice = getDevice

  return goto
}

module.exports.parseCookies = parseCookies
