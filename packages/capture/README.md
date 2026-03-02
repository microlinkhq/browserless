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

> @browserless/capture: Record a Puppeteer page using tabCapture API.

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
| `type` | `'webm' \| 'mp4'` | `'webm'` | Output type selector mapped to MediaRecorder mime type. |
| `path` | `string` | `undefined` | Write the captured media to disk. |
| `duration` | `number` | `3000` | Capture duration in milliseconds. |
| `audio` | `boolean \| object` | `false` | Capture audio. When object, it is used as audio track constraints. |
| `video` | `boolean \| object` | `true` | Capture video. When object, it is used as video track constraints. |

## Exports

- `capture.extensionPath`: Absolute path to the bundled extension.
- `capture.extensionId`: Extension ID used by the package.
- `capture.types`: Supported values for `type`.

`capture` uses `goto(...).device.viewport` as the capture viewport source.
When `video` is `true` or omitted, video constraints are inferred from that viewport to keep capture framing aligned with screenshot/pdf rendering.
When `video` is an object, that object is used as the video constraints.
When `audio` is an object, that object is used as the audio constraints.
The inferred constraints also account for `deviceScaleFactor`, so output video pixels match screenshot pixel density.
Bitrate hints are not configurable; capture uses Chrome MediaRecorder defaults.
MediaRecorder chunk size is internal and fixed at `250ms`.
`type` is mapped internally to the MediaRecorder mime type.
When `type` is `'mp4'`, the running Chromium build must support MP4 MediaRecorder output.
For strict screenshot/poster parity in headless mode, launch Chrome with matching `--screen-info`.

## License

**@browserless/capture** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.
