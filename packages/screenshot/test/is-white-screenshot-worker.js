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

    delete process.env.BROWSERLESS_SCREENSHOT_DISABLE_WORKER
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
