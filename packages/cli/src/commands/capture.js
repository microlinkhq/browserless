'use strict'

const capture = require('@browserless/capture')
const prettyBytes = require('pretty-bytes')

// Mode is selected at `require` time. Map the `--mode` flag onto each capture
// entry point so the CLI keeps runtime selection without a dispatch in the lib.
const MODE_ENTRYPOINTS = {
  extension: capture,
  screencast: require('@browserless/capture/screencast'),
  screenshot: require('@browserless/capture/screenshot')
}

module.exports = async ({ url, browserless, opts }) => {
  const { path: outputPath, mode, ...captureOpts } = opts

  const type = captureOpts.type && String(captureOpts.type).toLowerCase()

  const suggestedType =
    { matroska: 'mkv', mkv: 'mkv', mp4: 'mp4', webm: 'webm' }[type] ||
    (captureOpts.mimeType && captureOpts.mimeType.includes('mp4') ? 'mp4' : capture.DEFAULT.type)

  const browser = await browserless.browser()
  const page = await browser.defaultBrowserContext().newPage()
  const createCapture = MODE_ENTRYPOINTS[mode] || MODE_ENTRYPOINTS.extension
  const capturer = createCapture({ goto: browserless.goto })
  let video
  try {
    video = await capturer(page)(url, {
      ...captureOpts,
      path: outputPath
    })
  } finally {
    if (!page.isClosed()) await page.close()
  }

  const preview = outputPath
    ? `saved at ${process.cwd()}/${outputPath}`
    : `captured ${prettyBytes(video.length)} (use --path=./capture.${suggestedType} to persist)`

  return [video, preview]
}
