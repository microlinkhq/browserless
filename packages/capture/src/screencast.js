'use strict'

const createScreencast = require('@browserless/screencast')
const { even, record } = require('./recorder')
const { NOOP } = require('./constants')

// CDP `Page.startScreencast` delivers frames at the CSS-pixel layout viewport,
// NOT device pixels (unlike tab capture, which is retina/device-px). Size the
// output to the CSS viewport so frames fill it exactly without padding/upscaling.
// Net effect: the screencast backend is half the linear resolution of the
// extension backend for a 2x-DPR device. (Distinct from capture.js's device-px
// `getScaledSize`, hence the different name.)
const getViewportSize = viewport => ({
  width: even(viewport.width),
  height: even(viewport.height)
})

// Push source: CDP screencast frames muxed by their compositor-swap timestamp.
const startSource = async ({ page, muxer, width, height, quality }) => {
  const screencast = createScreencast(page, {
    format: 'jpeg',
    quality,
    maxWidth: width,
    maxHeight: height,
    everyNthFrame: 1
  })
  // metadata.timestamp is the compositor frame-swap wall time, in seconds.
  screencast.onFrame((data, metadata) =>
    muxer.write(Buffer.from(data, 'base64'), metadata.timestamp)
  )
  await screencast.start()
  return () => screencast.stop().catch(NOOP)
}

module.exports = (page, opts, viewport, hooks = {}) =>
  record(page, opts, viewport, {
    ...hooks,
    getSize: getViewportSize,
    startSource,
    label: 'screencast'
  })
