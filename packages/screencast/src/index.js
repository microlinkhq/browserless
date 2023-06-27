'use strict'

const { createScreenRecorder, startScreencast } = require('./utils')
const { dataUriToBuffer } = require('data-uri-to-buffer')

module.exports = async ({
  everyNthFrame = 1,
  format = 'video/webm;codecs=vp9',
  getBrowserless,
  gotoOpts,
  imageFormat = 'png',
  quality = 100,
  timeout,
  withPage
} = {}) => {
  const browserless = await getBrowserless()

  const fn = (page, goto) => async gotoOpts => {
    await goto(page, gotoOpts)

    const renderer = await browserless.page()
    const draws = []

    const screenRecorder = await createScreenRecorder(renderer, { format })

    const screencastStop = await startScreencast(page, {
      format: imageFormat,
      quality,
      everyNthFrame,
      onFrame: data => draws.push(screenRecorder.draw(data))
    })

    screenRecorder.start()

    await withPage(page)
    await screencastStop()
    await Promise.all(draws)

    const dataUri = await screenRecorder.stop()
    await renderer.close()

    return dataUriToBuffer(dataUri)
  }

  return browserless.withPage(fn, { timeout })(gotoOpts)
}
