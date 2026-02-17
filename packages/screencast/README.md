<div align="center">
  <img style="width: 500px; margin:3rem 0 1.5rem;" src="https://github.com/microlinkhq/browserless/raw/master/static/logo-banner.png#gh-light-mode-only" alt="browserless">
  <img style="width: 500px; margin:3rem 0 1.5rem;" src="https://github.com/microlinkhq/browserless/raw/master/static/logo-banner-light.png#gh-dark-mode-only" alt="browserless">
  <br><br>
  <a href="https://microlink.io"><img src="https://img.shields.io/badge/powered_by-microlink.io-blue?style=flat-square&color=%23EA407B" alt="Powered by microlink.io"></a>
  <img src="https://img.shields.io/github/tag/microlinkhq/browserless.svg?style=flat-square" alt="Last version">
  <a href="https://coveralls.io/github/microlinkhq/browserless"><img src="https://img.shields.io/coveralls/microlinkhq/browserless.svg?style=flat-square" alt="Coverage Status"></a>
  <a href="https://www.npmjs.org/package/browserless"><img src="https://img.shields.io/npm/dm/browserless.svg?style=flat-square" alt="NPM Status"></a>
  <br><br>
</div>

> @browserless/screencast: Browserless video recording using puppeteer.

See the [pdf section](https://browserless.js.org/#/?id=screencast) on our website for more information.

## Install

Using npm:

```sh
npm install @browserless/screencast --save
```

## About

This package provides **frame-by-frame video capture** from browser page navigation using the Chrome DevTools Protocol. It allows you to capture individual frames during page interactions for creating GIFs, videos, or frame-by-frame analysis.

### What This Package Does

The `@browserless/screencast` package allows you to:

- **Capture frames** during browser navigation and interactions
- **Control recording** with start/stop methods
- **Process frames** individually via callback functions
- **Configure quality and format** for captured frames
- **Create animations** like GIFs from captured frames

### Usage

```js
const createScreencast = require('@browserless/screencast')
const createBrowser = require('browserless')

const browser = createBrowser()
const browserless = await browser.createContext()
const page = await browserless.page()

const createScreencast = require('@browserless/screencast')
const createBrowser = require('browserless')

const browser = createBrowser()
const browserless = await browser.createContext()
const page = await browserless.page()

// Create screencast instance
const screencast = createScreencast(page, { 
  maxWidth: 1280, 
  maxHeight: 800 
})

// Collect frames
const frames = []
screencast.onFrame((data, metadata) => {
  frames.push({ data, metadata })
})

// Record during navigation
screencast.start()
await browserless.goto(page, { url: 'https://example.com' })
await screencast.stop()

console.log(`Captured ${frames.length} frames`)
```

### API

#### `createScreencast(page, options)`

Creates a screencast instance for the given Puppeteer page.

**Returns** an object with:

| Method | Description |
|--------|-------------|
| `start()` | Begin capturing frames |
| `stop()` | Stop capturing frames |
| `onFrame(callback)` | Register frame handler |

### Options

All options are passed directly to [Page.startScreencast](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `format` | `string` | `'jpeg'` | Image format: `'jpeg'` or `'png'` |
| `quality` | `number` | `80` | JPEG quality (0-100), ignored for PNG |
| `maxWidth` | `number` | — | Maximum width of captured frames |
| `maxHeight` | `number` | — | Maximum height of captured frames |
| `everyNthFrame` | `number` | `1` | Capture every Nth frame |

### Frame callback

The `onFrame` callback receives two arguments:

```js
screencast.onFrame((data, metadata) => {
  // data: base64-encoded image string
  // metadata: { timestamp, ... }
})
```

| Argument | Type | Description |
|----------|------|-------------|
| `data` | `string` | Base64-encoded frame image |
| `metadata` | `object` | Frame metadata including `timestamp` |

### Examples

#### Create a GIF from navigation

```js
const { GifEncoder } = require('@skyra/gifenc')
const { createCanvas, Image } = require('canvas')
const sharp = require('sharp')

const width = 640
const height = 400

const canvas = createCanvas(width, height)
const ctx = canvas.getContext('2d')
const encoder = new GifEncoder(width, height)

const screencast = createScreencast(page, { 
  maxWidth: width, 
  maxHeight: height 
})

screencast.onFrame(async data => {
  const frame = Buffer.from(data, 'base64')
  const buffer = await sharp(frame).resize({ width, height }).toBuffer()
  
  const img = new Image()
  img.src = buffer
  ctx.drawImage(img, 0, 0)
  encoder.addFrame(ctx)
})

encoder.start()
screencast.start()

await browserless.goto(page, { url: 'https://example.com' })

encoder.finish()
await screencast.stop()
```

#### Capture specific frames

```js
const screencast = createScreencast(page, {
  format: 'png',
  quality: 100,
  everyNthFrame: 5  // Capture every 5th frame
})

screencast.onFrame((data, metadata) => {
  console.log(`Frame at ${metadata.timestamp}`)
  // Save or process the frame
})
```

#### Save frames to disk

```js
const fs = require('fs').promises

let frameCount = 0

screencast.onFrame(async data => {
  const buffer = Buffer.from(data, 'base64')
  await fs.writeFile(`frame-${frameCount++}.jpg`, buffer)
})

screencast.start()
await page.goto('https://example.com')
await screencast.stop()
```

### How it fits in the monorepo

This is an **extended functionality package** for video/animation capture:

| Consumer | Purpose |
|----------|---------|
| User applications | Creating GIFs, video recording, visual testing |

### Dependencies

| Package | Purpose |
|---------|---------|
| `null-prototype-object` | Clean objects without prototype chain |

## License

**@browserless/screencast** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
