'use strict'

const timeSpan = require('@kikobeats/time-span')({ format: n => `${n.toFixed(2)}ms` })
const NullProtoObj = require('null-prototype-object')
const { createCanvas, Image } = require('canvas')
const { GifEncoder } = require('@skyra/gifenc')
const createBrowser = require('browserless')
const sharp = require('sharp')
const http = require('http')

const createScreencast = require('..')

const browser = createBrowser({
  timeout: 25000,
  lossyDeviceName: true,
  ignoreHTTPSErrors: true
})

const CACHE = new NullProtoObj()

const server = http.createServer(async (req, res) => {
  if (req.url === '/favicon.ico') return res.end()

  const duration = timeSpan()
  let firstFrame = true

  const url = req.url.slice(1)

  if (CACHE[url]) {
    const pngBuffer = CACHE[url].toBuffer('image/png')
    res.setHeader('Content-Type', 'image/png')
    res.write(pngBuffer)
    return res.end()
  }

  const browserless = await browser.createContext()
  const page = await browserless.page()
  let lastCanvas = null

  res.setHeader('Content-Type', 'image/gif')

  const width = 1280
  const height = 800
  const deviceScaleFactor = 0.5

  const outputSize = { width: width * deviceScaleFactor, height: height * deviceScaleFactor }

  const canvas = createCanvas(outputSize.width, outputSize.height)
  const ctx = canvas.getContext('2d')

  const encoder = new GifEncoder(outputSize.width, outputSize.height)
  encoder.createReadStream().pipe(res)

  const screencast = createScreencast(page, { maxWidth: width, maxHeight: height })

  screencast.onFrame(async data => {
    const frame = Buffer.from(data, 'base64')
    const buffer = await sharp(frame).resize(outputSize).toBuffer()

    const img = new Image()
    img.src = buffer
    ctx.drawImage(img, 0, 0, img.width, img.height)
    encoder.addFrame(ctx)

    if (firstFrame === true) firstFrame = duration()

    lastCanvas = canvas
  })

  screencast.start()
  encoder.start()
  await browserless.goto(page, { url })
  encoder.finish()
  await screencast.stop()

  console.log(`\n  Resolved ${url}; first frame ${firstFrame}, total ${duration()}`)

  CACHE[url] = lastCanvas
})

server.listen(3000, () =>
  console.log(`
  Listen: http://localhost:3000/{URL}
 Example: http://localhost:3000/https://browserless.js.org\n`)
)
