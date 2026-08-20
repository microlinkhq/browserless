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

> @browserless/ai: Chrome Built-in AI via browserless (Chrome for Testing, headless; GPU or CPU).

See the [ai section](https://browserless.js.org/#/?id=ai) on our website for more information.

## Install

Using npm:

```sh
npm install @browserless/ai --save
```

## About

This package runs [Chrome Built-in AI](https://developer.chrome.com/docs/ai/built-in-apis) from Node by evaluating the APIs on a browserless page.

Chrome for Testing cannot download Gemini Nano. Unpack a packed model into one directory, then pass that `dir` to `createAi` / `launch`. Chrome’s docs allow the foundation model on **GPU (>4 GB VRAM) or CPU (16 GB RAM, 4+ cores)**.

### Usage

```js
const createAi = require('@browserless/ai')

const { dir } = await createAi.unpack(dest => s3.download(url, dest))
const ai = createAi({ dir })

await ai.capabilities()
await ai.detectLanguage('https://example.com', { text: 'Hello, how are you today?' })
await ai.summarize('https://example.com', { type: 'tldr' })
await ai.prompt('https://example.com', { prompt: 'What is this page about?' })
await ai.extract('https://example.com', { schema })
await ai.translate('https://example.com', { text: 'Hello', sourceLanguage: 'en', targetLanguage: 'es' })
await ai.close()
```

`unpack` accepts a local zip path or a download function. The function can return a path, `Buffer`, stream, or S3 `GetObject` result, or write to the `dest` path it receives. Already-unpacked trees are reused unless `{ force: true }`.

If you already own the browser (lighthouse-style):

```js
const createBrowser = require('browserless')
const createAi = require('@browserless/ai')

const browser = createBrowser(createAi.launch({ dir: process.env.BROWSERLESS_AI_DIR }))
const ai = createAi(async teardown => {
  const browserless = await browser.createContext()
  teardown(() => browserless.destroyContext())
  return browserless
})
```

Each method is `(url, options)`. Input text is `options.text` when provided, otherwise `document.body.innerText` after navigation. Native create options are passed through.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dir` | `string` | `BROWSERLESS_AI_DIR` | Unpacked model tree (`nano/`, `prompt/`, `summarize/`, `detect/`) |
| `timeout` | `number` | browserless default | Launch and evaluate timeout (ms). `protocolTimeout` follows it |

`unpack(source, { dir, force })` writes to `dir` when given, otherwise `BROWSERLESS_AI_DIR` or `~/.cache/browserless-ai`.

### Pack a model

From a machine that already has Nano (desktop Chrome, or `BROWSERLESS_AI_DIR`):

```sh
pnpm --filter @browserless/ai pack-model
pnpm --filter @browserless/ai pack-model -- --upload
```

Writes `/tmp/browserless-ai-nano.zip`. `--upload` also pushes it to R2 (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).

### Example

```sh
pnpm --filter @browserless/ai start
pnpm --filter @browserless/ai start https://example.com
```

### Methods

| Method | Chrome API | Chrome |
|--------|------------|--------|
| `prompt` | `LanguageModel` | 148 |
| `extract` | `LanguageModel` + schema | 148 |
| `summarize` | `Summarizer` | 138 |
| `detectLanguage` | `LanguageDetector` | 138 |
| `translate` | `Translator` | 138 |
| `capabilities` | feature detect | — |

`extract` requires `schema`. `translate` requires `sourceLanguage` and `targetLanguage`. Language Detector and Translator are expert models. Prompt / Summarizer use Gemini Nano.

### How it fits in the monorepo

This is an **extended functionality package**. It is not wired into `browserless` core.

## License

**@browserless/ai** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
