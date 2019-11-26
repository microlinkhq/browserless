'use strict'

const createGoto = require('@browserless/goto')
const pReflect = require('p-reflect')

const isUrl = string => /^(https?|file):\/\/|^data:/.test(string)

const toArray = value => [].concat(value)

const getBoundingClientRect = element => {
  const { top, left, height, width, x, y } = element.getBoundingClientRect()
  return { top, left, height, width, x, y }
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

const hideElements = elements => {
  for (const element of elements) {
    if (element) element.style.display = 'none'
  }
}

const getInjectKey = (ext, value) =>
  isUrl(value) ? 'url' : value.endsWith(`.${ext}`) ? 'path' : 'content'

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  return async (page, url, opts = {}) => {
    const {
      device = 'macbook pro 13',
      waitUntil = ['load', 'networkidle2'],
      overlay,
      click,
      element,
      fullPage,
      hide,
      modules,
      scripts,
      scrollTo,
      styles,
      ...args
    } = opts

    if (overlay.browser) {
      const value = overlay.browser.includes('dark') ? 'dark' : 'light'
      await pReflect(page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value }]))
    }

    page.on('dialog', async dialog => {
      await dialog.dismiss()
    })

    await goto(page, { url, device, waitUntil, ...args })

    if (hide) {
      await Promise.all(
        toArray(hide).map(selector => pReflect(page.$$eval(selector, hideElements)))
      )
    }

    if (click) {
      for (const selector of toArray(click)) {
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
      if (typeof scrollTo === 'object') {
        await pReflect(page.$eval(scrollTo.element, scrollToElement, scrollTo))
      } else {
        await pReflect(page.$eval(scrollTo, scrollToElement))
      }
    }

    const screenshotOptions = {}

    if (element) {
      await page.waitForSelector(element, { visible: true })
      screenshotOptions.clip = await page.$eval(element, getBoundingClientRect)
      screenshotOptions.fullPage = false
    }

    return screenshotOptions
  }
}
