'use strict'

const { setTimeout: delay } = require('timers/promises')
const { spawn } = require('child_process')
const fs = require('fs/promises')
const debug = require('debug-logfmt')('browserless:capture')

const createScreencast = require('@browserless/screencast')
const { writeHeader, writeClusterHeader } = require('./ebml')
const { DEFAULT, NOOP } = require('./constants')

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'

// vp8/h264 require even dimensions.
const even = value => Math.round(value) & ~1

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

// Video encoder profiles, keyed by name and tagged with the container they mux
// into. The MediaRecorder-style `codec` (e.g. avc1.640028) does not apply to
// ffmpeg and is ignored here. Selectable per-request via the `encoder` opt so
// combinations can be benchmarked against each other in production; defaults
// (h264-ultrafast / vp8) are validated speed-first choices.
const ENCODER_PROFILES = {
  'h264-ultrafast': { container: 'mp4', codec: ['libx264', '-preset', 'ultrafast'] },
  'h264-veryfast': { container: 'mp4', codec: ['libx264', '-preset', 'veryfast'] },
  'h264-medium': { container: 'mp4', codec: ['libx264', '-preset', 'medium'] },
  h265: { container: 'mp4', codec: ['libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1'] },
  av1: { container: 'mp4', codec: ['libsvtav1', '-preset', '8', '-crf', '35'] },
  vp8: {
    container: 'webm',
    // vp8 realtime config (from Playwright) — predictable under load, unlike vp9
    // realtime which drops frames.
    codec: [
      'libvpx',
      '-qmin',
      '0',
      '-qmax',
      '50',
      '-crf',
      '8',
      '-deadline',
      'realtime',
      '-speed',
      '8',
      '-b:v',
      '1M'
    ]
  },
  vp9: {
    container: 'webm',
    codec: ['libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-crf', '30', '-b:v', '0']
  }
}

const DEFAULT_ENCODER_BY_CONTAINER = { mp4: 'h264-ultrafast', webm: 'vp8' }

// mp4 must be fragmented to stream to stdout (non-seekable output).
const CONTAINER_ARGS = {
  mp4: ['-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'],
  webm: ['-f', 'webm', 'pipe:1']
}

const resolveEncoder = (encoder, container) => {
  const profile = ENCODER_PROFILES[encoder]
  // Fall back to the container default for an unknown encoder or one that does
  // not mux into the requested container (e.g. vp9 requested with type=mp4).
  return profile && profile.container === container
    ? profile
    : ENCODER_PROFILES[DEFAULT_ENCODER_BY_CONTAINER[container]]
}

const getOutputArgs = ({ type, width, height, fps, encoder }) => {
  const container = type === 'webm' ? 'webm' : 'mp4'
  const { codec } = resolveEncoder(encoder, container)
  // Read frame timing from the Matroska stream we mux (explicit per-frame
  // timestamps) and emit a constant `fps`, duplicating frames as needed.
  return [
    '-loglevel',
    'error',
    '-f',
    'matroska',
    '-fpsprobesize',
    '0',
    '-probesize',
    '32',
    '-analyzeduration',
    '0',
    '-i',
    'pipe:0',
    '-y',
    '-an',
    '-r',
    String(fps),
    '-vf',
    `pad=${width}:${height}:0:0:gray,crop=${width}:${height}:0:0`,
    '-threads',
    '1',
    '-c:v',
    ...codec,
    '-pix_fmt',
    'yuv420p',
    ...CONTAINER_ARGS[container]
  ]
}

// Maps incoming frames onto a constant-fps grid by their real (compositor swap)
// timestamp, and muxes them into a Matroska stream for ffmpeg. Ported from the
// timing logic in Playwright's FfmpegVideoRecorder (Apache-2.0).
const createFrameMuxer = ({ stdin, fps, durationMs }) => {
  let firstTs
  let last = null

  const emit = (buffer, frameNumber) => {
    const timestampMs = Math.max(0, Math.round((frameNumber * 1000) / fps))
    stdin.write(writeClusterHeader(timestampMs, buffer.length))
    stdin.write(buffer)
  }

  return {
    write: (buffer, tsSeconds) => {
      if (firstTs === undefined) firstTs = tsSeconds
      // Hard-bound the clip to `duration`; async screencast stop can deliver a
      // few frames past the deadline that would otherwise lengthen the video.
      if ((tsSeconds - firstTs) * 1000 > durationMs) return
      const frameNumber = Math.floor((tsSeconds - firstTs) * fps)
      // A frame held on screen (no repaint) keeps its slot, so its real duration
      // is preserved instead of being collapsed.
      if (last && frameNumber !== last.frameNumber) emit(last.buffer, last.frameNumber)
      last = { buffer, frameNumber }
    },
    flush: () => {
      if (!last) return
      emit(last.buffer, last.frameNumber)
      // Hold the last frame out to the full requested duration. Screencast is
      // change-driven (no frame after the last repaint), so without this a page
      // that goes static produces a clip shorter than `duration`. ffmpeg `-r`
      // duplicates the held frame to fill the gap.
      const endFrameNumber = Math.floor((durationMs / 1000) * fps)
      if (endFrameNumber > last.frameNumber) emit(last.buffer, endFrameNumber)
    }
  }
}

module.exports = async (page, opts, viewport, { onStarted } = {}) => {
  const {
    path: outputPath,
    duration = DEFAULT.duration,
    fps = DEFAULT.fps,
    type = DEFAULT.type,
    encoder,
    quality = 90,
    ffmpegPath = FFMPEG_PATH
  } = opts

  const { width, height } = getViewportSize(viewport)

  const ffmpeg = spawn(ffmpegPath, getOutputArgs({ type, width, height, fps, encoder }), {
    stdio: ['pipe', 'pipe', 'pipe']
  })

  const chunks = []
  let stderr = ''
  ffmpeg.stdout.on('data', chunk => chunks.push(chunk))
  ffmpeg.stderr.on('data', chunk => (stderr += chunk.toString()))
  ffmpeg.stdin.on('error', NOOP)

  const exited = new Promise((resolve, reject) => {
    ffmpeg.on('error', err =>
      reject(
        new Error(
          `ffmpeg failed to start (${ffmpegPath}): ${err.message}. Install ffmpeg to use the screencast backend.`
        )
      )
    )
    ffmpeg.on('close', code =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`))
    )
  })

  const muxer = createFrameMuxer({ stdin: ffmpeg.stdin, fps, durationMs: duration })
  ffmpeg.stdin.write(writeHeader(width, height))

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

  let captureError
  let navigation = Promise.resolve()
  try {
    // Apply the viewport before the first frame so the screencast captures at the
    // intended size from the start (goto re-applies it idempotently during nav).
    await page.setViewport(viewport).catch(NOOP)
    await screencast.start()

    // The screencast is rolling: only now kick off navigation so the page's load
    // and intro animations are captured from the first frame. Navigation runs
    // concurrently and is NOT awaited here, so the recording window stays bounded
    // to `duration` regardless of how long the page takes to load.
    navigation = (onStarted ? Promise.resolve().then(onStarted) : Promise.resolve()).catch(
      error => {
        captureError = error
      }
    )
    await delay(duration)
  } catch (error) {
    captureError = captureError || error
  } finally {
    await screencast.stop().catch(NOOP)
    muxer.flush()
    ffmpeg.stdin.end()
  }

  const buffer = await exited
  // Let navigation settle before returning so the caller doesn't tear the page
  // down mid-navigation (goto has its own timeout, so this can't hang).
  await navigation
  if (captureError) throw captureError

  if (buffer.length === 0) {
    throw new Error(
      'No video data was captured. Increase `duration` or verify playback in the tab.'
    )
  }

  if (outputPath) {
    await fs.writeFile(outputPath, buffer)
    debug('screencast.writeFile', { outputPath, bytes: buffer.length })
  }

  return buffer
}

module.exports.ENCODERS = Object.keys(ENCODER_PROFILES)
module.exports.getOutputArgs = getOutputArgs
