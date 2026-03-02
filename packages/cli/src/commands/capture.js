'use strict'

const prettyBytes = require('pretty-bytes')

module.exports = async ({ url, browserless, opts }) => {
  const { path: outputPath, ...captureOpts } = opts

  const type = captureOpts.type && String(captureOpts.type).toLowerCase()

  const suggestedType =
    { matroska: 'mkv', mkv: 'mkv', mp4: 'mp4', webm: 'webm' }[type] ||
    (captureOpts.mimeType && captureOpts.mimeType.includes('mp4') ? 'mp4' : 'webm')

  const video = await browserless.capture(url, {
    ...captureOpts,
    path: outputPath
  })

  const preview = outputPath
    ? `saved at ${process.cwd()}/${outputPath}`
    : `captured ${prettyBytes(video.length)} (use --path=./capture.${suggestedType} to persist)`

  return [video, preview]
}
