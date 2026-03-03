'use strict'

const createBrowser = require('../../browserless/src')
const createCapture = require('..')

const { defaultArgs } = createBrowser.driver

const CANDIDATES = Object.freeze([
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=hvc1',
  'video/webm;codecs=av1'
])

const URL = process.env.URL || 'https://example.com'

const main = async () => {
  const browser = createBrowser({
    headless: 'new',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      ...defaultArgs,
      `--allowlisted-extension-id=${createCapture.extensionId}`,
      `--disable-extensions-except=${createCapture.extensionPath}`,
      `--load-extension=${createCapture.extensionPath}`
    ]
  })

  const browserless = await browser.createContext()

  try {
    const puppeteerBrowser = await browserless.browser()
    const page = await puppeteerBrowser.defaultBrowserContext().newPage()

    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded' })

      const report = await page.evaluate(candidates => {
        const MediaRecorderClass = globalThis.MediaRecorder
        const hasMediaRecorder =
          typeof MediaRecorderClass !== 'undefined' &&
          typeof MediaRecorderClass.isTypeSupported === 'function'

        if (!hasMediaRecorder) {
          return {
            hasMediaRecorder: false,
            userAgent: navigator.userAgent,
            supported: [],
            unsupported: candidates
          }
        }

        const supported = candidates.filter(type => MediaRecorderClass.isTypeSupported(type))
        const unsupported = candidates.filter(type => !MediaRecorderClass.isTypeSupported(type))

        return {
          hasMediaRecorder: true,
          userAgent: navigator.userAgent,
          supported,
          unsupported
        }
      }, CANDIDATES)

      console.log('MediaRecorder support report')
      console.log(`URL: ${URL}`)
      console.log(`User Agent: ${report.userAgent}`)
      console.log(`MediaRecorder available: ${report.hasMediaRecorder}`)
      console.log('Supported:', report.supported)
      console.log('Unsupported:', report.unsupported)
    } finally {
      if (!page.isClosed()) await page.close().catch(() => {})
    }
  } finally {
    await browserless.destroyContext({ force: true }).catch(() => {})
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
