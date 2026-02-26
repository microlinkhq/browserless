'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const test = require('ava')

test('uses worker thread path when available', t => {
  const isWhitePath = path.resolve(__dirname, '../src/is-white-screenshot.js')
  const whiteFixture = path.resolve(__dirname, './fixtures/white-5k.png')
  const nonWhiteFixture = path.resolve(__dirname, './fixtures/no-white-5k.png')

  const script = `
    const fs = require('fs')
    const workerThreads = require('worker_threads')
    const OriginalWorker = workerThreads.Worker
    let workerCount = 0

    workerThreads.Worker = class WorkerSpy extends OriginalWorker {
      constructor (...args) {
        workerCount += 1
        super(...args)
      }
    }

    const isWhite = require(${JSON.stringify(isWhitePath)})

    Promise.all([
      isWhite(fs.readFileSync(${JSON.stringify(whiteFixture)})),
      isWhite(fs.readFileSync(${JSON.stringify(nonWhiteFixture)}))
    ])
      .then(([white, nonWhite]) => {
        process.stdout.write(JSON.stringify({ workerCount, white, nonWhite }))
        process.exit(0)
      })
      .catch(error => {
        console.error(error)
        process.exit(1)
      })
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  const result = JSON.parse(stdout.trim())
  t.true(result.workerCount >= 1)
  t.true(result.white)
  t.false(result.nonWhite)
})

test('rejects in-flight requests when worker exits with code 0', t => {
  const isWhitePath = path.resolve(__dirname, '../src/is-white-screenshot.js')
  const whiteFixture = path.resolve(__dirname, './fixtures/white-5k.png')

  const script = `
    const fs = require('fs')
    const workerThreads = require('worker_threads')
    const OriginalWorker = workerThreads.Worker

    workerThreads.Worker = class WorkerExitZero extends OriginalWorker {
      constructor () {
        super(
          "const { parentPort } = require('worker_threads'); parentPort.on('message', () => process.exit(0))",
          { eval: true }
        )
      }
    }

    const isWhite = require(${JSON.stringify(isWhitePath)})
    const screenshot = fs.readFileSync(${JSON.stringify(whiteFixture)})
    const timeout = setTimeout(() => {
      process.stdout.write(JSON.stringify({ timedOut: true }))
      process.exit(0)
    }, 1500)

    isWhite(screenshot)
      .then(() => {
        clearTimeout(timeout)
        process.stdout.write(JSON.stringify({ resolved: true }))
        process.exit(0)
      })
      .catch(error => {
        clearTimeout(timeout)
        process.stdout.write(JSON.stringify({ rejected: true, message: error.message }))
        process.exit(0)
      })
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  const result = JSON.parse(stdout.trim())
  t.false(Boolean(result.timedOut), 'request should not hang when worker exits')
  t.true(Boolean(result.rejected), 'request should be rejected on worker exit')
  t.regex(result.message, /exited with code 0/)
})
