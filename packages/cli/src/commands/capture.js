'use strict'

const prettyBytes = require('pretty-bytes')
const createCapture = require('@browserless/capture')

module.exports = async ({ url, browserless, opts }) => {
  const browser = await browserless.browser()
  const page = await browser.newPage()
  const capture = createCapture({ goto: browserless.goto })

  const { path: outputPath, ...captureOpts } = opts
  const type = captureOpts.type && String(captureOpts.type).toLowerCase()
  const suggestedType =
    { matroska: 'mkv', mkv: 'mkv', mp4: 'mp4', webm: 'webm' }[type] ||
    (captureOpts.mimeType && captureOpts.mimeType.includes('mp4') ? 'mp4' : 'webm')

  let video

  try {
    video = await capture(page)(url, {
      ...captureOpts,
      path: outputPath
    })
  } finally {
    await page.close().catch(() => {})
  }

  const preview = outputPath
    ? `saved at ${process.cwd()}/${outputPath}`
    : `captured ${prettyBytes(video.length)} (use --path=./capture.${suggestedType} to persist)`

  return [video, preview]
}
