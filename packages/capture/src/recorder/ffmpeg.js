'use strict'

// ffmpeg encoding for the frame-based modes: encoder profiles, output-arg
// construction, and a thin spawn helper. The screencast recorder feeds this a
// Matroska stream (see ./ebml.js) on stdin and reads the encoded video on stdout.

const { spawn } = require('child_process')

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'

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
  // Normalize like the extension mode (trim/lowercase/strip leading dot) so
  // `WEBM` or `.webm` resolve to the webm container rather than defaulting to mp4.
  const container = String(type).trim().toLowerCase().replace(/^\./, '') === 'webm' ? 'webm' : 'mp4'
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

// Spawn ffmpeg with the given args. Returns the child's `stdin` (the caller
// writes the Matroska stream into it and ends it) and `output`, a promise that
// resolves to the encoded video Buffer once ffmpeg exits cleanly. `timeout`
// (ms) bounds the whole process: if ffmpeg hasn't exited by then it is killed
// and `output` rejects, so a stuck encoder can't leave a capture open forever.
const spawnFfmpeg = ({ ffmpegPath = FFMPEG_PATH, args, timeout }) => {
  const ffmpeg = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })

  const chunks = []
  let stderr = ''
  ffmpeg.stdout.on('data', chunk => chunks.push(chunk))
  ffmpeg.stderr.on('data', chunk => (stderr += chunk.toString()))
  ffmpeg.stdin.on('error', () => {})

  const output = new Promise((resolve, reject) => {
    const timer = timeout
      ? setTimeout(() => {
        ffmpeg.kill('SIGKILL')
        reject(new Error(`ffmpeg did not finish within ${timeout}ms`))
      }, timeout)
      : null
    timer?.unref()

    ffmpeg.on('error', err => {
      clearTimeout(timer)
      reject(
        new Error(
          `ffmpeg failed to start (${ffmpegPath}): ${err.message}. Install ffmpeg to use the screencast or screenshot mode.`
        )
      )
    })
    ffmpeg.on('close', code => {
      clearTimeout(timer)
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`))
    })
  })

  return { stdin: ffmpeg.stdin, output }
}

module.exports = {
  FFMPEG_PATH,
  ENCODERS: Object.keys(ENCODER_PROFILES),
  getOutputArgs,
  spawnFfmpeg
}
