'use strict'

const { createCanvas, Image } = require('canvas')
const createBrowser = require('browserless')
const GIFEncoder = require('gifencoder')
const http = require('http')

const createScreencast = require('..')
const ffmpeg = require('./ffmpeg')

const browser = createBrowser({
  timeout: 25000,
  lossyDeviceName: true,
  ignoreHTTPSErrors: true
})

const CACHE = Object.create(null)

const server = http.createServer(async (req, res) => {
  if (req.url === '/favicon.ico') return res.end()
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
  const resizeRatio = 0.5

  const outputSize = { width: width * resizeRatio, height: height * resizeRatio }

  const encoder = new GIFEncoder(outputSize.width, outputSize.height)
  const canvas = createCanvas(outputSize.width, outputSize.height)
  const ctx = canvas.getContext('2d')

  encoder.createWriteStream({ repeat: -1, delay: 0 }).pipe(res)

  const screencast = createScreencast(page, {
    quality: 0,
    format: 'png',
    everyNthFrame: 1
  })

  screencast.onFrame(async data => {
    const frame = Buffer.from(data, 'base64')
    const img = new Image()
    img.src = await ffmpeg(frame, outputSize)
    ctx.drawImage(img, 0, 0, img.width, img.height)
    encoder.addFrame(ctx)
    lastCanvas = canvas
  })

  screencast.start()
  encoder.start()
  await browserless.goto(page, { url, viewport: { width, height, deviceScaleFactor: 1 } })
  encoder.finish()
  await screencast.stop()

  CACHE[url] = lastCanvas
})

server.listen(3000, () =>
  console.log(`
  Listen: http://localhost:3000/{URL}
 Example: http://localhost:3000/https://browserless.js.org\n`)
)
