<div align="center">
  <img style="width: 500px; margin:3rem 0 1.5rem;" src="https://github.com/microlinkhq/browserless/raw/master/static/logo-banner.png#gh-light-mode-only" alt="browserless">
  <img style="width: 500px; margin:3rem 0 1.5rem;" src="https://github.com/microlinkhq/browserless/raw/master/static/logo-banner-light.png#gh-dark-mode-only" alt="browserless">
  <br><br>
  <a href="https://microlink.io"><img src="https://img.shields.io/badge/powered_by-microlink.io-blue?style=flat-square&color=%23EA407B" alt="Powered by microlink.io"></a>
  <img src="https://img.shields.io/github/tag/microlinkhq/browserless.svg?style=flat-square" alt="Last version">
  <a href="https://coveralls.io/github/microlinkhq/browserless"><img src="https://img.shields.io/coveralls/microlinkhq/browserless.svg?style=flat-square" alt="Coverage Status"></a>
  <a href="https://www.npmjs.org/package/@browserless/capture"><img src="https://img.shields.io/npm/dm/@browserless/capture.svg?style=flat-square" alt="NPM Status"></a>
  <br><br>
</div>

> @browserless/capture: Record a Puppeteer page using the extension + `tabCapture` approach.

## Install

```sh
npm install @browserless/capture --save
```

## Usage

```js
const createBrowser = require('browserless')
const createCapture = require('@browserless/capture')

const browser = createBrowser({
  headless: 'new',
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--screen-info={2560x1600 devicePixelRatio=2}',
    `--allowlisted-extension-id=${createCapture.extensionId}`,
    `--disable-extensions-except=${createCapture.extensionPath}`,
    `--load-extension=${createCapture.extensionPath}`
  ]
})

const browserless = await browser.createContext()
const page = await browserless.page()
const capture = createCapture({ goto: browserless.goto })

const video = await capture(page)('https://example.com', {
  duration: 5000,
  type: 'mp4',
  path: '/tmp/demo.mp4'
})
```

API shape is intentionally simple, similar to `page.screenshot()`/`page.pdf()`:

```js
const capture = createCapture({ goto })
await capture(page)(url, opts)
```

Returns a `Buffer` and writes to `opts.path` when provided.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `waitUntil` | `string` | `'networkidle2'` | Navigation strategy passed to `goto`. |
| `fitToScreen` | `boolean` | `true` | Temporarily fit tab viewport to capturable screen to avoid offset crops. |
| `type` | `'webm' \| 'mp4' \| 'mkv' \| 'matroska'` | inferred from `path` or `'webm'` | Friendly output type selector. |
| `path` | `string` | `undefined` | Write the captured media to disk. |
| `duration` | `number` | `3000` | Capture duration in milliseconds. |
| `timeout` | `number` | `max(duration * 3, 30000)` | Timeout waiting for stream data. |
| `audio` | `boolean` | `false` | Capture audio. |
| `video` | `boolean` | `true` | Capture video. |
| `mimeType` | `string` | inferred from `type`/`path` | MediaRecorder mime type. |
| `frameSize` | `number` | `20` | Milliseconds per MediaRecorder chunk. |
| `audioBitsPerSecond` | `number` | `undefined` | Audio bitrate hint. |
| `videoBitsPerSecond` | `number` | `undefined` | Video bitrate hint. |
| `bitsPerSecond` | `number` | `undefined` | Combined bitrate hint. |
| `videoConstraints` | `object` | `undefined` | `chrome.tabCapture` video constraints. |
| `audioConstraints` | `object` | `undefined` | `chrome.tabCapture` audio constraints. |
| `tabQuery` | `object` | `{ active: true }` | Query used by `chrome.tabs.query`. |
| `retry` | `{ each?: number, times?: number }` | `{ each: 20, times: 3 }` | Extension readiness retry policy. |
| `signal` | `AbortSignal` | `undefined` | Abort capture. |

## Exports

- `capture.extensionPath`: Absolute path to the bundled extension.
- `capture.extensionId`: Extension ID used by the package.
- `capture.types`: Supported values for `type`.

By default, `videoConstraints` is inferred from the current page viewport to keep capture framing aligned with screenshot/pdf rendering.
The inferred constraints also account for `deviceScaleFactor`, so output video pixels match screenshot pixel density.
The capture flow also adjusts tab surface bounds to the current viewport before recording, so the first video frame matches screenshot framing in headless mode.
Use `type` for simple container selection and `mimeType` when you need exact codec control.
For strict screenshot/poster parity in headless mode, launch Chrome with matching `--screen-info`.

## License

**@browserless/capture** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.
