'use strict'

const { EventEmitter, getEventListeners } = require('events')
const fs = require('fs/promises')
const path = require('path')
const os = require('os')
const { default: test } = require('ava')

const createFramesCapture = require('../src/frames')
const { createFrameMuxer } = require('../src/recorder')
const { writeHeader, writeClusterHeader } = require('../src/recorder/ebml')
const { MODES } = require('..')

const VIEWPORT = { width: 640, height: 400, deviceScaleFactor: 1 }

const pendingTimeouts = () =>
  process.getActiveResourcesInfo().filter(name => name === 'Timeout').length

const createGoto = (onCall, fallback = VIEWPORT) => {
  const goto = async (page, opts) => {
    await onCall?.(page, opts)
    return { device: { viewport: opts.viewport || fallback } }
  }
  goto.getDevice = ({ viewport } = {}) => ({ viewport: viewport || fallback })
  return goto
}

const createPage = ({
  hasTimeweb = true,
  timewebAt,
  onFrame,
  onDocumentCheck,
  childFrames = [],
  renders = () => true,
  detachFails = false,
  removeFails = false,
  goToError = null
} = {}) => {
  const events = []
  const virtualTimes = []
  let screenshots = 0
  let mark
  const mainFrame = {
    evaluate: async (fn, arg) => {
      if (typeof arg === 'string') {
        const previous = global.window
        global.window = {}
        try {
          await fn(arg)
          mark = global.window.__browserlessFrames
          return mark
        } finally {
          if (previous === undefined) delete global.window
          else global.window = previous
        }
      }
      if (arg && typeof arg === 'object') {
        const previous = global.window
        global.window = { __browserlessFrames: mark }
        try {
          await onDocumentCheck?.(arg)
          return await fn(arg)
        } finally {
          if (previous === undefined) delete global.window
          else global.window = previous
        }
      }
      const ms = arg
      virtualTimes.push(ms)
      await onFrame?.(virtualTimes.length - 1)
      const previous = global.window
      const armed = timewebAt === undefined || virtualTimes.length >= timewebAt
      global.window =
        hasTimeweb && armed
          ? {
              timeweb: {
                goTo: () => (goToError ? Promise.reject(goToError) : Promise.resolve())
              }
            }
          : {}
      try {
        return await fn(ms)
      } finally {
        if (previous === undefined) delete global.window
        else global.window = previous
      }
    }
  }
  const client = {
    send: async (method, params) => {
      events.push([method, params])
      const verdict = renders(screenshots)
      if (verdict && typeof verdict.then === 'function') return verdict
      if (!verdict) return new Promise(() => {})
      return { data: Buffer.from(`frame-${screenshots++}`).toString('base64') }
    },
    detach: async () => {
      events.push(['detach'])
      if (detachFails) throw new Error('detach failed')
    }
  }
  const page = {
    events,
    virtualTimes,
    setViewport: async viewport => events.push(['setViewport', viewport]),
    viewport: () => VIEWPORT,
    evaluateOnNewDocument: async source => {
      events.push(['inject', source.includes('timeweb')])
      return { identifier: 'timeweb-script' }
    },
    removeScriptToEvaluateOnNewDocument: async identifier => {
      events.push(['remove', identifier])
      if (removeFails) throw new Error('remove failed')
    },
    mainFrame: () => mainFrame,
    frames: () => [mainFrame, ...childFrames],
    createCDPSession: async () => client,
    dropDocument: () => {
      mark = undefined
    }
  }
  return page
}

const createChildFrame = ({ fails = false, error } = {}) => {
  const virtualTimes = []
  return {
    virtualTimes,
    evaluate: async (fn, ms) => {
      if (fails) throw error || new Error('Execution context was destroyed')
      virtualTimes.push(ms)
      return true
    }
  }
}

const expectedStream = ({ frames, fps }) =>
  Buffer.concat([
    writeHeader(VIEWPORT.width, VIEWPORT.height),
    ...Array.from({ length: frames }, (_, frame) => {
      const payload = Buffer.from(`frame-${frame}`)
      return Buffer.concat([
        writeClusterHeader(Math.round((frame * 1000) / fps), payload.length),
        payload
      ])
    })
  ])

const startsWithHeader = (buffer, width, height) => {
  const header = writeHeader(width, height)
  return buffer.subarray(0, header.length).equals(header)
}

test.before(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-frames-'))
  const ffmpegPath = path.join(dir, 'ffmpeg')
  const argsFile = path.join(dir, 'args')
  const stdinFile = path.join(dir, 'stdin')
  await fs.writeFile(
    ffmpegPath,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nexec tee '${stdinFile}'\n`,
    { mode: 0o755 }
  )
  test.ffmpegPath = ffmpegPath
  test.argsFile = argsFile
  test.stdinFile = stdinFile
})

test('frames is listed as a mode', t => {
  t.true(MODES.includes('frames'))
})

test('steps virtual time one frame at a time and muxes every frame on its slot', async t => {
  const page = createPage()
  const capture = createFramesCapture({ goto: createGoto() })
  const result = await capture(page)('https://example.com', {
    duration: 100,
    fps: 30,
    ffmpegPath: test.ffmpegPath
  })
  t.deepEqual(page.virtualTimes, [0, 1000 / 30, 2000 / 30])
  t.deepEqual(result, expectedStream({ frames: 3, fps: 30 }))
})

test('injects timeweb before navigation and removes it after the capture', async t => {
  const page = createPage()
  const capture = createFramesCapture({
    goto: createGoto(page => page.events.push(['goto']))
  })
  await capture(page)('https://example.com', { duration: 40, fps: 50, ffmpegPath: test.ffmpegPath })
  const names = page.events.map(([name]) => name)
  t.deepEqual(names.slice(0, 3), ['setViewport', 'inject', 'goto'])
  t.is(names.at(-1), 'remove')
  t.deepEqual(page.events[1], ['inject', true])
})

test('takes each frame as a fast jpeg at the given quality', async t => {
  const page = createPage()
  const capture = createFramesCapture({ goto: createGoto() })
  await capture(page)('https://example.com', {
    duration: 20,
    fps: 50,
    quality: 70,
    ffmpegPath: test.ffmpegPath
  })
  t.deepEqual(
    page.events.find(([name]) => name === 'Page.captureScreenshot'),
    ['Page.captureScreenshot', { format: 'jpeg', quality: 70, optimizeForSpeed: true }]
  )
})

test('a frame rate that does not divide a second keeps every frame on its own slot', async t => {
  const page = createPage()
  const capture = createFramesCapture({ goto: createGoto() })
  const result = await capture(page)('https://example.com', {
    duration: 1000,
    fps: 49,
    ffmpegPath: test.ffmpegPath
  })
  t.is(page.virtualTimes.length, 49)
  t.deepEqual(result, expectedStream({ frames: 49, fps: 49 }))
})

test('frame count rounds `duration * fps`, with at least one frame', t => {
  const { frameCount } = createFramesCapture
  t.is(frameCount({ duration: 5000, fps: 30 }), 150)
  t.is(frameCount({ duration: 5000, fps: 60 }), 300)
  t.is(frameCount({ duration: 1, fps: 30 }), 1)
})

test('rejects when the page has no timeweb, and still removes the script', async t => {
  const page = createPage({ hasTimeweb: false })
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(
    () =>
      capture(page)('https://example.com', { duration: 100, fps: 30, ffmpegPath: test.ffmpegPath }),
    { message: /needs the page loaded by `goto`/ }
  )
  t.deepEqual(page.events.at(-1), ['remove', 'timeweb-script'])
})

test('an aborted signal stops stepping and rejects with its reason', async t => {
  const controller = new AbortController()
  const reason = new Error('over budget')
  const page = createPage({ onFrame: frame => frame === 2 && controller.abort(reason) })
  const capture = createFramesCapture({ goto: createGoto() })
  const error = await t.throwsAsync(() =>
    capture(page)('https://example.com', {
      duration: 1000,
      fps: 30,
      signal: controller.signal,
      ffmpegPath: test.ffmpegPath
    })
  )
  t.is(error, reason)
  t.is(page.virtualTimes.length, 3)
  t.deepEqual(page.events.at(-1), ['remove', 'timeweb-script'])
})

test('a navigation failure rejects before any frame', async t => {
  const page = createPage()
  const capture = createFramesCapture({
    goto: createGoto(() => {
      throw new Error('navigation failed')
    })
  })
  await t.throwsAsync(
    () => capture(page)('https://example.com', { duration: 100, ffmpegPath: test.ffmpegPath }),
    { message: 'navigation failed' }
  )
  t.deepEqual(page.virtualTimes, [])
  t.deepEqual(page.events.at(-1), ['remove', 'timeweb-script'])
})

test('advances every frame of the page to the same virtual time', async t => {
  const child = createChildFrame()
  const page = createPage({ childFrames: [child] })
  const capture = createFramesCapture({ goto: createGoto() })
  await capture(page)('https://example.com', {
    duration: 100,
    fps: 30,
    ffmpegPath: test.ffmpegPath
  })
  t.deepEqual(child.virtualTimes, [0, 1000 / 30, 2000 / 30])
})

test('a child frame that goes away does not fail the capture', async t => {
  const page = createPage({ childFrames: [createChildFrame({ fails: true })] })
  const capture = createFramesCapture({ goto: createGoto() })
  const result = await capture(page)('https://example.com', {
    duration: 100,
    fps: 30,
    ffmpegPath: test.ffmpegPath
  })
  t.deepEqual(result, expectedStream({ frames: 3, fps: 30 }))
})

test('a frame that never renders rejects after `frameTimeout`', async t => {
  const page = createPage({ renders: frame => frame < 1 })
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(
    () =>
      capture(page)('https://example.com', {
        duration: 100,
        fps: 30,
        frameTimeout: 50,
        ffmpegPath: test.ffmpegPath
      }),
    { message: 'Frame 1 did not render within 50ms.' }
  )
  t.deepEqual(page.events.slice(-2), [['detach'], ['remove', 'timeweb-script']])
})

test('rejects when `video` is disabled', async t => {
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(() => capture(createPage())('https://example.com', { video: false }), {
    instanceOf: TypeError,
    message: /video.*cannot be disabled/
  })
})

test('writes `path` and returns the same buffer', async t => {
  const output = path.join(os.tmpdir(), `capture-frames-${process.pid}.mkv`)
  const capture = createFramesCapture({ goto: createGoto() })
  const result = await capture(createPage())('https://example.com', {
    duration: 40,
    fps: 50,
    path: output,
    ffmpegPath: test.ffmpegPath
  })
  t.deepEqual(await fs.readFile(output), result)
  await fs.rm(output)
})

test('`video: true` captures the same way as leaving video on', async t => {
  const page = createPage()
  const capture = createFramesCapture({ goto: createGoto() })
  const result = await capture(page)('https://example.com', {
    video: true,
    duration: 100,
    fps: 30,
    ffmpegPath: test.ffmpegPath
  })
  t.deepEqual(result, expectedStream({ frames: 3, fps: 30 }))
})

test('an already aborted signal does not leave an encoder failure unhandled', async t => {
  const fail = path.join(path.dirname(test.ffmpegPath), 'fail-now')
  await fs.writeFile(fail, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const controller = new AbortController()
  const reason = new Error('over budget')
  controller.abort(reason)
  const unhandled = []
  const onUnhandled = error => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  try {
    const page = createPage()
    const capture = createFramesCapture({ goto: createGoto() })
    const error = await t.throwsAsync(() =>
      capture(page)('https://example.com', {
        duration: 100,
        fps: 30,
        signal: controller.signal,
        ffmpegPath: fail
      })
    )
    await new Promise(resolve => setImmediate(resolve))
    t.is(error, reason)
    t.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('an already aborted signal rejects before any frame', async t => {
  const controller = new AbortController()
  const reason = new Error('over budget')
  controller.abort(reason)
  const page = createPage()
  const capture = createFramesCapture({ goto: createGoto() })
  const error = await t.throwsAsync(() =>
    capture(page)('https://example.com', {
      duration: 1000,
      fps: 30,
      signal: controller.signal,
      ffmpegPath: test.ffmpegPath
    })
  )
  t.is(error, reason)
  t.deepEqual(page.virtualTimes, [])
  t.deepEqual(page.events.at(-1), ['remove', 'timeweb-script'])
})

test('uses the default duration, frame rate, jpeg quality, and mp4 encoder', async t => {
  const page = createPage()
  const capture = createFramesCapture({ goto: createGoto() })
  const timers = pendingTimeouts()
  await capture(page)('https://example.com', { ffmpegPath: test.ffmpegPath })
  t.is(page.virtualTimes.length, 300)
  t.is(page.virtualTimes[1], 1000 / 60)
  t.deepEqual(
    page.events.find(([name]) => name === 'Page.captureScreenshot'),
    ['Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true }]
  )
  t.true((await fs.readFile(test.argsFile, 'utf8')).includes('libx264'))
  t.is(pendingTimeouts(), timers)
})

test('a frame that never renders rejects after the default frame timeout', async t => {
  const page = createPage({ renders: () => false })
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(
    () =>
      capture(page)('https://example.com', {
        duration: 100,
        fps: 30,
        ffmpegPath: test.ffmpegPath
      }),
    { message: 'Frame 0 did not render within 5000ms.' }
  )
})

test('a virtual-time seek that fails rejects the capture', async t => {
  const reason = new Error('seek failed')
  const page = createPage({ goToError: reason })
  const capture = createFramesCapture({ goto: createGoto() })
  const error = await t.throwsAsync(() =>
    capture(page)('https://example.com', { duration: 100, fps: 30, ffmpegPath: test.ffmpegPath })
  )
  t.is(error, reason)
  t.deepEqual(page.events.at(-1), ['remove', 'timeweb-script'])
})

test('a main frame that goes away rejects and still removes the script', async t => {
  const page = createPage()
  const gone = {
    evaluate: async () => {
      throw new Error('Execution context was destroyed')
    }
  }
  page.mainFrame = () => gone
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(
    () =>
      capture(page)('https://example.com', { duration: 100, fps: 30, ffmpegPath: test.ffmpegPath }),
    { message: 'Execution context was destroyed' }
  )
  t.deepEqual(page.events.at(-1), ['remove', 'timeweb-script'])
})

test('detaching the CDP session can fail without losing the video', async t => {
  const page = createPage({ detachFails: true })
  const capture = createFramesCapture({ goto: createGoto() })
  const result = await capture(page)('https://example.com', {
    duration: 40,
    fps: 50,
    ffmpegPath: test.ffmpegPath
  })
  t.deepEqual(result, expectedStream({ frames: 2, fps: 50 }))
})

test('removing the injected script can fail without losing the video', async t => {
  const page = createPage({ removeFails: true })
  const capture = createFramesCapture({ goto: createGoto() })
  const result = await capture(page)('https://example.com', {
    duration: 40,
    fps: 50,
    ffmpegPath: test.ffmpegPath
  })
  t.deepEqual(result, expectedStream({ frames: 2, fps: 50 }))
})

test('a capture failure is not replaced when ffmpeg exits with an error', async t => {
  const fail = path.join(path.dirname(test.ffmpegPath), 'fail')
  await fs.writeFile(fail, '#!/bin/sh\ncat >/dev/null\nexit 1\n', { mode: 0o755 })
  const page = createPage({ hasTimeweb: false })
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(
    () => capture(page)('https://example.com', { duration: 100, fps: 30, ffmpegPath: fail }),
    { message: /needs the page loaded by `goto`/ }
  )
})

test('a screenshot that fails after the frame timeout does not reject twice', async t => {
  const page = createPage({
    renders: () =>
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late')), 80))
  })
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(
    () =>
      capture(page)('https://example.com', {
        duration: 100,
        fps: 30,
        frameTimeout: 20,
        ffmpegPath: test.ffmpegPath
      }),
    { message: 'Frame 0 did not render within 20ms.' }
  )
  await new Promise(resolve => setTimeout(resolve, 120))
})

test('`timeout` kills ffmpeg when the encoder does not exit', async t => {
  const hang = path.join(path.dirname(test.ffmpegPath), 'hang')
  await fs.writeFile(hang, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
  const page = createPage()
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(
    () =>
      capture(page)('https://example.com', {
        duration: 40,
        fps: 50,
        timeout: 50,
        ffmpegPath: hang
      }),
    { message: /did not finish within 50ms/ }
  )
})

test('sizes the video at device pixels', async t => {
  const capture = createFramesCapture({ goto: createGoto() })
  const retina = await capture(createPage())('https://example.com', {
    duration: 40,
    fps: 50,
    ffmpegPath: test.ffmpegPath,
    viewport: { width: 640, height: 400, deviceScaleFactor: 2 }
  })
  t.true(startsWithHeader(retina, 1280, 800))

  const missing = await capture(createPage())('https://example.com', {
    duration: 40,
    fps: 50,
    ffmpegPath: test.ffmpegPath,
    viewport: { width: 640, height: 400 }
  })
  t.true(startsWithHeader(missing, 640, 400))

  const fractional = await capture(createPage())('https://example.com', {
    duration: 40,
    fps: 50,
    ffmpegPath: test.ffmpegPath,
    viewport: { width: 640, height: 400, deviceScaleFactor: 0.5 }
  })
  t.true(startsWithHeader(fractional, 640, 400))
})

test('a document that is still navigating does not fail the clock pump', async t => {
  let attempts = 0
  let navigated
  const navigation = new Promise(resolve => {
    navigated = resolve
  })
  const page = createPage({
    onFrame: () => {
      attempts += 1
      if (attempts < 3) throw new Error('Execution context was destroyed')
      navigated()
    }
  })
  const capture = createFramesCapture({ goto: createGoto(() => navigation) })
  await capture(page)('https://example.com', { duration: 40, fps: 50, ffmpegPath: test.ffmpegPath })
  t.true(attempts >= 3)
})

test('the clock waits until timeweb is on the document', async t => {
  const page = createPage({ timewebAt: 2 })
  const capture = createFramesCapture({
    goto: createGoto(async () => {
      while (!page.released && page.virtualTimes.length < 2) {
        await new Promise(resolve => setImmediate(resolve))
      }
    })
  })
  try {
    await capture(page)('https://example.com', {
      duration: 40,
      fps: 50,
      ffmpegPath: test.ffmpegPath
    })
    t.deepEqual(page.virtualTimes.slice(0, 2), [0, 0])
  } finally {
    page.released = true
  }
})

test('a child error from the step still in flight fails the capture', async t => {
  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  let failed = false
  const page = createPage({
    childFrames: [
      {
        evaluate: async () => {
          release()
          await new Promise(resolve => setImmediate(resolve))
          if (!failed) {
            failed = true
            throw new Error('timer failed')
          }
          return true
        }
      }
    ]
  })
  const capture = createFramesCapture({ goto: createGoto(() => gate) })
  await t.throwsAsync(
    () =>
      capture(page)('https://example.com', { duration: 40, fps: 50, ffmpegPath: test.ffmpegPath }),
    { message: 'timer failed' }
  )
})

test('a finished clock step clears its timeout and abort listener', async t => {
  const controller = new AbortController()
  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  const page = createPage({
    childFrames: [
      {
        evaluate: async () => {
          release()
          await new Promise(resolve => setImmediate(resolve))
          return true
        }
      }
    ]
  })
  const capture = createFramesCapture({ goto: createGoto(() => gate) })
  const timers = pendingTimeouts()
  const listeners = getEventListeners(controller.signal, 'abort').length
  await capture(page)('https://example.com', {
    duration: 40,
    fps: 50,
    signal: controller.signal,
    ffmpegPath: test.ffmpegPath
  })
  t.is(pendingTimeouts(), timers)
  t.is(getEventListeners(controller.signal, 'abort').length, listeners)
})

test('an abort during the in-flight step rejects the capture', async t => {
  const controller = new AbortController()
  const reason = new Error('over budget')
  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  const page = createPage({
    childFrames: [
      {
        evaluate: async () => {
          release()
          controller.abort(reason)
          await new Promise(() => {})
        }
      }
    ]
  })
  const capture = createFramesCapture({ goto: createGoto(() => gate) })
  try {
    const error = await t.throwsAsync(() =>
      Promise.race([
        capture(page)('https://example.com', {
          duration: 40,
          fps: 50,
          signal: controller.signal,
          frameTimeout: 5000,
          ffmpegPath: test.ffmpegPath
        }),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('still running')), 500))
      ])
    )
    t.is(error, reason)
  } finally {
    controller.abort()
  }
})

test('a clock step that never finishes rejects after the frame timeout', async t => {
  const controller = new AbortController()
  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  const page = createPage({
    childFrames: [
      {
        evaluate: async () => {
          release()
          await new Promise(() => {})
        }
      }
    ]
  })
  const capture = createFramesCapture({ goto: createGoto(() => gate) })
  const started = Date.now()
  try {
    const error = await t.throwsAsync(() =>
      Promise.race([
        capture(page)('https://example.com', {
          duration: 40,
          fps: 50,
          frameTimeout: 200,
          signal: controller.signal,
          ffmpegPath: test.ffmpegPath
        }),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('still running')), 1000)
        )
      ])
    )
    t.true(Date.now() - started >= 150)
    t.is(error.message, 'The clock did not advance within 200ms.')
  } finally {
    controller.abort()
  }
})

test('an abort while goto is waiting rejects the capture', async t => {
  const controller = new AbortController()
  const reason = new Error('over budget')
  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  const page = createPage()
  const capture = createFramesCapture({ goto: createGoto(() => gate) })
  try {
    const pending = capture(page)('https://example.com', {
      duration: 40,
      fps: 50,
      signal: controller.signal,
      ffmpegPath: test.ffmpegPath
    })
    await new Promise(resolve => setImmediate(resolve))
    controller.abort(reason)
    const error = await t.throwsAsync(() =>
      Promise.race([
        pending,
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('still running')), 500))
      ])
    )
    t.is(error, reason)
  } finally {
    release()
  }
})

test('a child timer error while goto is waiting fails the capture', async t => {
  let fail = true
  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  const page = createPage({
    childFrames: [
      {
        evaluate: async () => {
          if (fail) throw new Error('timer failed')
          return true
        }
      }
    ]
  })
  const capture = createFramesCapture({ goto: createGoto(() => gate) })
  try {
    const error = await t.throwsAsync(() =>
      Promise.race([
        capture(page)('https://example.com', {
          duration: 40,
          fps: 50,
          ffmpegPath: test.ffmpegPath
        }),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('still running')), 500))
      ])
    )
    t.is(error.message, 'timer failed')
  } finally {
    fail = false
    release()
  }
})

test('virtual time advances while goto is still waiting', async t => {
  const page = createPage()
  const capture = createFramesCapture({
    goto: createGoto(async () => {
      while (!page.released && page.virtualTimes.length < 3) {
        await new Promise(resolve => setImmediate(resolve))
      }
    })
  })
  try {
    await capture(page)('https://example.com', {
      duration: 40,
      fps: 50,
      ffmpegPath: test.ffmpegPath
    })
    t.true(page.virtualTimes.length > 3)
    t.true(page.virtualTimes.at(-1) > page.virtualTimes[2])
  } finally {
    page.released = true
  }
})

test('an abort during the only frame rejects before the frame is written', async t => {
  const controller = new AbortController()
  const reason = new Error('over budget')
  const page = createPage({ onFrame: () => controller.abort(reason) })
  const capture = createFramesCapture({ goto: createGoto() })
  const error = await t.throwsAsync(() =>
    capture(page)('https://example.com', {
      duration: 1,
      fps: 30,
      signal: controller.signal,
      ffmpegPath: test.ffmpegPath
    })
  )
  t.is(error, reason)
  const written = await fs.readFile(test.stdinFile)
  t.is(written.length, writeHeader(VIEWPORT.width, VIEWPORT.height).length)
})

test('an abort during the last write rejects', async t => {
  const controller = new AbortController()
  const reason = new Error('over budget')
  let checks = 0
  const page = createPage({
    onDocumentCheck: () => {
      checks += 1
      if (checks === 1) controller.abort(reason)
    }
  })
  const capture = createFramesCapture({ goto: createGoto() })
  const error = await t.throwsAsync(() =>
    capture(page)('https://example.com', {
      duration: 1,
      fps: 30,
      signal: controller.signal,
      ffmpegPath: test.ffmpegPath
    })
  )
  t.is(error, reason)
})

test('a navigation mid-capture rejects', async t => {
  const page = createPage({
    onFrame: frame => {
      if (frame === 1) page.dropDocument()
    }
  })
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(
    () =>
      capture(page)('https://example.com', { duration: 100, fps: 30, ffmpegPath: test.ffmpegPath }),
    { message: 'The page navigated away mid-capture.' }
  )
  t.deepEqual(page.events.at(-1), ['remove', 'timeweb-script'])
})

test('a detached child frame does not fail the capture', async t => {
  const page = createPage({
    childFrames: [createChildFrame({ fails: true, error: new Error('Frame was detached') })]
  })
  const capture = createFramesCapture({ goto: createGoto() })
  const result = await capture(page)('https://example.com', {
    duration: 100,
    fps: 30,
    ffmpegPath: test.ffmpegPath
  })
  t.deepEqual(result, expectedStream({ frames: 3, fps: 30 }))
})

test('an error in a child frame fails the capture', async t => {
  const page = createPage({
    childFrames: [createChildFrame({ fails: true, error: new Error('timer failed') })]
  })
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(
    () =>
      capture(page)('https://example.com', { duration: 100, fps: 30, ffmpegPath: test.ffmpegPath }),
    { message: 'timer failed' }
  )
})

test('ffmpeg dying mid-capture rejects with the encoder error', async t => {
  const hang = path.join(path.dirname(test.ffmpegPath), 'hang-mid')
  await fs.writeFile(hang, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
  const page = createPage({ renders: () => false })
  const capture = createFramesCapture({ goto: createGoto() })
  await t.throwsAsync(
    () =>
      capture(page)('https://example.com', {
        duration: 100,
        fps: 30,
        timeout: 50,
        frameTimeout: 400,
        ffmpegPath: hang
      }),
    { message: /did not finish within 50ms/ }
  )
})

test('frame muxer `writeFrame` emits a frame on the slot it is given', t => {
  const stdin = new EventEmitter()
  const writes = []
  stdin.write = chunk => writes.push(chunk)
  const muxer = createFrameMuxer({ stdin, fps: 49, durationMs: 1000 })
  muxer.writeFrame(Buffer.from('a'), 0)
  muxer.writeFrame(Buffer.from('b'), 1)
  t.deepEqual(writes, [
    writeClusterHeader(0, 1),
    Buffer.from('a'),
    writeClusterHeader(Math.round(1000 / 49), 1),
    Buffer.from('b')
  ])
})
