'use strict'

// Shared ffmpeg recording pipeline for the frame-based modes (screencast and
// screenshot). Both feed real per-frame timestamps into a constant-fps Matroska
// muxer that ffmpeg encodes; they differ only in how frames are sourced and how
// the output is sized, which the caller supplies via `getSize`/`startSource`.

const { setTimeout: delay } = require('timers/promises')
const fs = require('fs/promises')
const debug = require('debug-logfmt')('browserless:capture')

const { writeHeader, writeClusterHeader } = require('./ebml')
const { getOutputArgs, spawnFfmpeg } = require('./ffmpeg')
const { DEFAULT, NOOP } = require('../constants')

// vp8/h264 require even dimensions.
const even = value => Math.round(value) & ~1

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

// Run a frame-based capture end to end. `getSize(viewport)` returns the encoded
// `{ width, height }`; `startSource({ page, muxer, width, height, fps, quality })`
// begins producing frames into `muxer.write(buffer, tsSeconds)` and resolves to a
// `stop()` that halts it. `label` tags errors/logs to the calling mode.
const record = async (page, opts, viewport, { onStarted, getSize, startSource, label }) => {
  const {
    path: outputPath,
    duration = DEFAULT.duration,
    fps = DEFAULT.fps,
    type = DEFAULT.type,
    encoder,
    quality = 90,
    ffmpegPath
  } = opts

  // These modes capture video only; mirror the extension mode's "must
  // capture something" guard rather than silently producing video.
  if (opts.video === false) {
    throw new TypeError(`The ${label} mode captures video; \`video\` cannot be disabled.`)
  }

  const { width, height } = getSize(viewport)

  const { stdin, output } = spawnFfmpeg({
    ffmpegPath,
    args: getOutputArgs({ type, width, height, fps, encoder }),
    // Bound the whole process so a stuck ffmpeg can't hang the capture: the
    // recording window (`duration`) plus generous headroom for the post-
    // `stdin.end()` encode flush (slower than realtime for heavy encoders).
    timeout: Math.ceil(duration * 2) + 10_000
  })

  const muxer = createFrameMuxer({ stdin, fps, durationMs: duration })
  stdin.write(writeHeader(width, height))

  let captureError
  let navigation = Promise.resolve()
  let stop = NOOP
  // Bounds the recording window; aborted early if navigation fails so a goto
  // error surfaces immediately instead of after the full `duration`.
  const recordingWindow = new AbortController()
  try {
    // The viewport is already applied (by `prepareViewport`) before the first
    // frame, so frames are captured at the intended size from the start; goto
    // re-applies it idempotently during navigation.
    stop = await startSource({ page, muxer, width, height, fps, quality })

    // The source is rolling: only now kick off navigation so the page's load and
    // intro animations are captured from the first frame. Navigation runs
    // concurrently — it does not extend the recording window (so the clip stays
    // bounded to `duration` on slow loads), but a failure ends it early.
    navigation = Promise.resolve(onStarted?.()).catch(error => {
      captureError = error
      recordingWindow.abort()
    })
    await delay(duration, undefined, { signal: recordingWindow.signal }).catch(NOOP)
  } catch (error) {
    captureError = captureError || error
  } finally {
    await stop()
    muxer.flush()
    stdin.end()
  }

  let buffer
  try {
    buffer = await output
  } catch (error) {
    // Prefer the underlying capture/navigation failure over a downstream ffmpeg
    // error (a non-zero exit is expected when an early abort leaves little data).
    throw captureError || error
  }
  // Let navigation settle before returning so the caller doesn't tear the page
  // down mid-navigation (goto has its own timeout, so this can't hang).
  await navigation
  if (captureError) throw captureError

  if (buffer.length === 0) {
    throw new Error('No video data was captured. Increase `duration` or verify the page renders.')
  }

  if (outputPath) {
    await fs.writeFile(outputPath, buffer)
    debug(`${label}.writeFile`, { outputPath, bytes: buffer.length })
  }

  return buffer
}

module.exports = { even, createFrameMuxer, record }
