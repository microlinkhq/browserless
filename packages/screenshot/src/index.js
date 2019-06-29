'use strict'

const svgGradient = require('svg-gradient')
const goto = require('@browserless/goto')
const isUrl = require('is-url-http')
const sharp = require('sharp')
const path = require('path')

const toArray = value => [].concat(value)

const browserOverlay = ['safari-light', 'safari-dark'].reduce(
  (acc, key) => ({
    ...acc,
    [key]: path.resolve(__dirname, `browser/${key}.png`)
  }),
  {}
)

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

const scrollToElement = (element, options) => {
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

const hideElements = elements => {
  for (const element of elements) {
    element.style.visibility = 'hidden'
  }
}

const createBackground = css => Buffer.from(svgGradient(css, { width: '1388px', height: '955px' }))

const getInjectKey = (ext, value) =>
  isUrl(value) ? 'url' : value.endsWith(`.${ext}`) ? 'path' : 'content'

module.exports = page => async (url, opts = {}) => {
  const {
    adblock = true,
    device = 'macbook pro 13',
    type = 'png',
    viewport,
    hide,
    click,
    disableAnimations,
    modules,
    scripts,
    styles,
    element,
    scrollTo,
    overlay,
    ...args
  } = opts

  await goto(page, { url, device, adblock, ...args })

  if (disableAnimations) {
    await page.evaluate(doDisableAnimations)
  }

  if (hide) {
    await Promise.all(toArray(hide).map(selector => page.$$eval(selector, hideElements)))
  }

  if (click) {
    for (const selector of toArray(click)) {
      await page.click(selector)
    }
  }

  if (modules) {
    await Promise.all(
      toArray(modules).map(m => {
        return page.addScriptTag({
          [getInjectKey('js', m)]: m,
          type: 'module'
        })
      })
    )
  }

  if (scripts) {
    await Promise.all(
      toArray(scripts).map(script => {
        return page.addScriptTag({
          [getInjectKey('js', script)]: script
        })
      })
    )
  }

  if (styles) {
    await Promise.all(
      toArray(styles).map(style => {
        return page.addStyleTag({
          [getInjectKey('css', style)]: style
        })
      })
    )
  }

  if (scrollTo) {
    if (typeof scrollTo === 'object') {
      await page.$eval(scrollTo.element, scrollToElement, scrollTo)
    } else {
      await page.$eval(scrollTo, scrollToElement)
    }
  }

  const screenshot = await page.screenshot({ type, ...args })
  if (!overlay) return screenshot

  let { browser: browserTheme, background = 'transparent' } = overlay

  if (!background.includes('gradient')) {
    background = `linear-gradient(45deg, ${background} 0%, ${background} 100%)`
  }
  let image = await sharp(Buffer.from(createBackground(background)))
  let inputs = [{ input: screenshot }]

  if (browserTheme) {
    const input = browserOverlay[browserTheme]
    if (input) inputs = [{ input }].concat(inputs)
  }

  image = await image.composite(inputs)

  const buffer = await image.toBuffer()
  return buffer
}
