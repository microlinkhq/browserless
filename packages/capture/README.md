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

The capture mode is selected by [entry point](#modes), not by an option.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `'webm' \| 'mp4'` | `'mp4'` | Output type selector mapped to MediaRecorder mime type. |
| `codec` | `string` | Depends on `type` | MediaRecorder codec override. Defaults: `webm -> vp9`, `mp4 -> avc1.4D401F`. |
| `path` | `string` | `undefined` | Write the captured media to disk. |
| `duration` | `number` | `5000` | Capture duration in milliseconds. |
| `audio` | `boolean \| object` | `false` | Capture audio. When object, it is used as audio track constraints. |
| `video` | `boolean \| object` | `true` | Capture video. When object, it is used as video track constraints. |

## Modes

Each capture mode is a separate entry point, so you pull in only what you use
(e.g. the `extension` mode doesn't load the ffmpeg-based deps):

```js
const createCapture = require('@browserless/capture') // extension (default)
const createCapture = require('@browserless/capture/screencast')
const createCapture = require('@browserless/capture/screenshot')
```

All three share the same factory signature — `createCapture({ goto })(page)(url, opts)`.

| Entry point | How | Notes |
| --- | --- | --- |
| `@browserless/capture` (`/extension`) | In-browser MediaRecorder via the bundled extension (`tabCapture`). | Default. Device-pixel (retina) output. Captures `audio`. |
| `@browserless/capture/screencast` | CDP `Page.startScreencast` frames muxed into ffmpeg. | Video-only (`video: false` throws). CSS-pixel output. Requires `ffmpeg`. |
| `@browserless/capture/screenshot` | Polled `page.screenshot` frames muxed into ffmpeg. | Video-only. The only mode that captures accelerated layers (WebGL/canvas/video). Device-pixel output, bounded by screenshot latency. Requires `ffmpeg`. |

## Exports

- `capture.extensionPath`: Absolute path to the bundled extension.
- `capture.extensionId`: Extension ID used by the package.
- `capture.MODES`: Names of the available capture modes (entry points).
- `capture.types`: Supported values for `type`.

`capture` uses `goto(...).device.viewport` as the capture viewport. When `video` is `true` or omitted, video constraints are inferred from that viewport so framing matches screenshot and PDF. Pass an object for `video` or `audio` to set those constraints yourself.

Inferred constraints include `deviceScaleFactor`, so output pixels match screenshot density.

`type` maps to a MediaRecorder mime type. `codec` is appended as `;codecs=...`. Defaults are `vp9` for `webm` and `avc1.4D401F` for `mp4`. Override per request with `opts.codec`:

```js
await capture(page)(url, { type: 'webm', codec: 'vp8' })
await capture(page)(url, { type: 'mp4', codec: 'avc1.640033' })
```

When `type` is `'mp4'`, Chromium must support MP4 MediaRecorder output. For screenshot/poster parity in headless mode, launch Chrome with matching `--screen-info`.

## License

**@browserless/capture** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
