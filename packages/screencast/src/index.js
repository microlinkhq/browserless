'use strict'

const { unlink, readFile } = require('fs/promises')
const { randomUUID } = require('crypto')
const { Readable } = require('stream')
const { tmpdir } = require('os')
const execa = require('execa')
const path = require('path')

const { startScreencast } = require('./utils')

// Inspired by https://github.com/microsoft/playwright/blob/37b3531a1181c99990899c15000925a98f035eb7/packages/playwright-core/src/server/chromium/videoRecorder.ts#L101
const ffmpegArgs = format => {
  // `-an` disables audio
  // `-b:v 0` disables video bitrate control
  // `-c:v` alias for -vcodec
  // `-avioflags direct` reduces buffering
  // `-probesize 32` size of the data to analyze to get stream information
  // `-analyzeduration 0` specify how many microseconds are analyzed to probe the input
  // `-fpsprobesize 0` set number of frames used to probe fps
  // `-fflags nobuffer` disables buffering when reading or writing multimedia data
  const args =
    '-loglevel error -an -b:v 0 -avioflags direct -probesize 32 -analyzeduration 0 -fpsprobesize 0 -fflags nobuffer'

  if (format === 'mp4') {
    // ffmpeg -h encoder=h264
    return `${args} -c:v libx264 -pix_fmt yuv420p -preset ultrafast -realtime true`
  }

  if (format === 'gif') {
    return args
  }

  if (format === 'webm') {
    // ffmpeg -h encoder=vp9
    return `${args} -c:v libvpx-vp9 -quality realtime`
  }

  throw new TypeError(`Format '${format}' not supported`)
}

module.exports = async ({
  ffmpegPath,
  format = 'webm',
  frameRate = 25,
  frames: framesOpts = {},
  getBrowserless,
  gotoOpts,
  timeout,
  tmpPath = tmpdir(),
  withPage
} = {}) => {
  const browserless = await getBrowserless()

  const fn = (page, goto) => async gotoOpts => {
    await goto(page, gotoOpts)
    const screencastStop = await startScreencast(page, framesOpts)
    await withPage(page)
    const frames = await screencastStop()

    const interpolatedFrames = frames.reduce((acc, { data, metadata }, index) => {
      const previousIndex = index - 1
      const previousFrame = index > 0 ? frames[previousIndex] : undefined
      const durationSeconds = previousFrame
        ? metadata.timestamp - previousFrame.metadata.timestamp
        : 0
      const numFrames = Math.max(1, Math.round(durationSeconds * frameRate))
      for (let i = 0; i < numFrames; i++) acc.push(data)
      return acc
    }, [])

    const filepath = path.join(tmpPath, `${randomUUID()}.${format}`)
    const subprocess = execa.command(
      `${ffmpegPath} -f image2pipe -i pipe:0 -r ${frameRate} ${ffmpegArgs(format)} ${filepath}`
    )
    Readable.from(interpolatedFrames).pipe(subprocess.stdin)

    await subprocess
    const buffer = await readFile(filepath)
    await unlink(filepath)

    return buffer
  }

  return browserless.withPage(fn, { timeout })(gotoOpts)
}
