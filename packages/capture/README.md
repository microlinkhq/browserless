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

const withCaptureExtension = (launchOpts = {}) => {
  const ignoreDefaultArgs = launchOpts.ignoreDefaultArgs

  return {
    ...launchOpts,
    args: [
      ...(launchOpts.args || []),
      `--allowlisted-extension-id=${createCapture.extensionId}`,
      `--disable-extensions-except=${createCapture.extensionPath}`,
      `--load-extension=${createCapture.extensionPath}`
    ],
    ignoreDefaultArgs:
      ignoreDefaultArgs === true
        ? true
        : [
            ...new Set([
              ...(Array.isArray(ignoreDefaultArgs) ? ignoreDefaultArgs : []),
              '--disable-extensions'
            ])
          ]
  }
}

const browser = createBrowser(withCaptureExtension({ headless: 'new' }))

const browserless = await browser.createContext()
const puppeteerBrowser = await browserless.browser()
const page = await puppeteerBrowser.defaultBrowserContext().newPage()
const capture = createCapture({ goto: browserless.goto })

const video = await capture(page)('https://example.com', {
  duration: 5000,
  type: 'mp4',
  codec: 'avc1.4D401F',
  path: '/tmp/demo.mp4'
})

await page.close()
await browserless.destroyContext()
await browser.close()
```

`browserless` core does not inject capture extension flags automatically.
`@browserless/capture` requires:

- Loading the bundled extension using `--allowlisted-extension-id`, `--disable-extensions-except`, and `--load-extension`.
- Ensuring Chromium default arg `--disable-extensions` is ignored.
- Creating the captured page from `defaultBrowserContext()` (not an incognito context).

API shape is intentionally simple, similar to `page.screenshot()`/`page.pdf()`:

```js
const capture = createCapture({ goto })
await capture(page)(url, opts)
```

Returns a `Buffer` and writes to `opts.path` when provided.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `'webm' \| 'mp4'` | `'mp4'` | Output type selector mapped to MediaRecorder mime type. |
| `codec` | `string` | Depends on `type` | MediaRecorder codec override. Defaults: `webm -> vp9`, `mp4 -> avc1.4D401F`. |
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
Capture always enforces `videoConstraints.mandatory.maxFrameRate = 120`.
MediaRecorder chunk size is internal and fixed at `250ms`.
`type` is mapped internally to the MediaRecorder mime type, and `codec` is appended as `;codecs=...`.
Default codecs are `vp9` for `webm` and `avc1.4D401F` for `mp4`.
You can override codec per request using `opts.codec`.
For example:

```js
await capture(page)(url, { type: 'webm', codec: 'vp8' })
await capture(page)(url, { type: 'mp4', codec: 'avc1.640033' })
```

When `type` is `'mp4'`, the running Chromium build must support MP4 MediaRecorder output.
For strict screenshot/poster parity in headless mode, launch Chrome with matching `--screen-info`.

## License

**@browserless/capture** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.
