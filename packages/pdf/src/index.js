'use strict'

const createGoto = require('@browserless/goto')
const pReflect = require('p-reflect')

const {
  captureWithNavigationRetry,
  createPrepare,
  dismissDialogs,
  expandOverflow,
  SCREENSHOT_DEFAULT_OPTS
} = require('@browserless/screenshot')

const PDF_DEFAULT_OPTS = {
  margin: '0.35cm',
  scale: 0.65,
  printBackground: true,
  waitUntil: 'auto',
  isPageReady: SCREENSHOT_DEFAULT_OPTS.isPageReady
}

const PROBE_OPTS = { optimizeForSpeed: true, type: 'jpeg', quality: 30 }

const loadTimeout = ({ timeout, stepTimeout }) => timeout ?? stepTimeout

const getMargin = unit => {
  if (!unit) return unit
  if (typeof unit === 'object') return unit
  return {
    top: unit,
    right: unit,
    bottom: unit,
    left: unit
  }
}

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)
  const prepareDocument = createPrepare(goto)

  const render = (page, opts = {}) => {
    const {
      margin = PDF_DEFAULT_OPTS.margin,
      scale = PDF_DEFAULT_OPTS.scale,
      printBackground = PDF_DEFAULT_OPTS.printBackground,
      ...rest
    } = opts

    return dismissDialogs(page, async () => {
      await pReflect(expandOverflow(page))
      return captureWithNavigationRetry(
        () =>
          page.pdf({
            ...rest,
            margin: getMargin(margin),
            printBackground,
            scale
          }),
        { page, goto, timeout: goto.timeouts.action(rest.timeout) }
      )
    })
  }

  const prepare = (page, url, opts = {}) => {
    const {
      waitUntil = PDF_DEFAULT_OPTS.waitUntil,
      isPageReady = PDF_DEFAULT_OPTS.isPageReady,
      element,
      codeScheme,
      ...rest
    } = opts

    return dismissDialogs(page, () =>
      prepareDocument(page, url, {
        ...rest,
        waitUntil,
        isPageReady,
        fullPage: true,
        probe: () => PROBE_OPTS,
        readyTimeout: loadTimeout
      })
    )
  }

  const pdf =
    page =>
      async (url, opts = {}) => {
        await prepare(page, url, opts)
        return render(page, opts)
      }

  pdf.prepare = prepare
  pdf.render = render
  return pdf
}

module.exports.DEFAULT_OPTS = PDF_DEFAULT_OPTS
