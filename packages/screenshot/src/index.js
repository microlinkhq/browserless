'use strict'

const goto = require('@browserless/goto')
const isUrl = require('is-url-http')
const hexRgb = require('hex-rgb')
const sharp = require('sharp')
const path = require('path')

const defaultOverlayPath = path.resolve(__dirname, 'browser.png')

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

const doScrollToElement = (element, options) => {
  const rect = element.getBoundingClientRect()
  const offset = calculateOffset(rect, options)
  const parent = findScrollParent(element)

  if (parent !== undefined) {
    parent.scrollTo(offset.x, offset.y)
  }
}

const doDisableAnimations = () => {
  const rule = `
  *,
  ::before,
  ::after {
    animation: initial !important;
    transition: initial !important;
  }
`
  const style = document.createElement('style')
  document.body.append(style)
  style.sheet.insertRule(rule)
}

const doHideElements = elements => {
  for (const element of elements) {
    element.style.visibility = 'hidden'
  }
}

const doRemoveElements = elements => {
  for (const element of elements) {
    element.style.display = 'none'
  }
}

const getOverlayColors = color => {
  let r = 0
  let g = 0
  let b = 0

  try {
    ;({ red: r, green: g, blue: b } = hexRgb(color))
  } catch (e) {
    color = 'transparent'
  }

  return [r, g, b]
}

const getInjectKey = (ext, value) =>
  isUrl(value) ? 'url' : value.endsWith(`.${ext}`) ? 'path' : 'content'

module.exports = page => async (url, opts = {}) => {
  const {
    adblock = true,
    device = 'macbook pro 13',
    type = 'png',
    viewport,
    hideElements,
    removeElements,
    clickElement,
    disableAnimations,
    modules,
    scripts,
    styles,
    element,
    scrollToElement,
    overlay,
    ...args
  } = opts

  await goto(page, { url, device, adblock, ...args })

  if (disableAnimations) {
    await page.evaluate(doDisableAnimations)
  }

  if (hideElements) {
    await Promise.all(hideElements.map(selector => page.$$eval(selector, doHideElements)))
  }

  if (removeElements) {
    await Promise.all(removeElements.map(selector => page.$$eval(selector, doRemoveElements)))
  }

  if (clickElement) await page.click(clickElement)

  if (modules) {
    await Promise.all(
      modules.map(module_ => {
        return page.addScriptTag({
          [getInjectKey('js', module_)]: module_,
          type: 'module'
        })
      })
    )
  }

  if (scripts) {
    await Promise.all(
      scripts.map(script => {
        return page.addScriptTag({
          [getInjectKey('js', script)]: script
        })
      })
    )
  }

  if (styles) {
    await Promise.all(
      styles.map(style => {
        return page.addStyleTag({
          [getInjectKey('css', style)]: style
        })
      })
    )
  }

  if (scrollToElement) {
    if (typeof scrollToElement === 'object') {
      await page.$eval(scrollToElement.element, scrollToElement, scrollToElement)
    } else {
      await page.$eval(scrollToElement, doScrollToElement)
    }
  }

  const screenshot = await page.screenshot({ type, ...args })
  if (!overlay) return screenshot

  const { path: overlayPath = defaultOverlayPath, color: overlayColor = 'transparent' } = overlay
  let image = await sharp(overlayPath).composite([{ input: screenshot, top: 138, left: 112 }])

  if (overlayColor !== 'transparent') {
    const [r, g, b] = getOverlayColors(overlayColor)
    image = await image.flatten({ background: { r, g, b, alpha: 1 } })
  }

  const buffer = await image.toBuffer()
  return buffer
}
