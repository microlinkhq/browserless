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

> @browserless/ai: Chrome Built-in AI (Prompt, Summarizer, Translator, Language Detector) via browserless.

See the [ai section](https://browserless.js.org/#/?id=ai) on our website for more information.

## Install

Using npm:

```sh
npm install @browserless/ai --save
```

## About

This package runs [Chrome Built-in AI](https://developer.chrome.com/docs/ai/built-in-apis) APIs from Node by evaluating them on a browserless page.

It requires **Google Chrome** (not Puppeteer's bundled Chromium). Pass `executablePath` when creating the browser. Persist `userDataDir` so Gemini Nano is not re-downloaded on every run.

### Usage

```js
const createAi = require('@browserless/ai')
const createBrowser = require('browserless')

const browser = createBrowser({
  executablePath: '/path/to/Google Chrome'
})

const ai = createAi(async teardown => {
  const browserless = await browser.createContext()
  teardown(() => browserless.destroyContext())
  return browserless
})

await ai.summarize('https://example.com', { type: 'tldr' })
await ai.prompt('https://example.com', { prompt: 'What is this page about?' })
await ai.translate('https://example.com', { sourceLanguage: 'en', targetLanguage: 'es' })
await ai.detectLanguage('https://example.com')
```

Each method is `(url, options)`. Input text is `options.text` when provided, otherwise `document.body.innerText` after navigation.

### Methods

| Method | Chrome API | Chrome |
|--------|------------|--------|
| `prompt` | `LanguageModel` | 148 |
| `summarize` | `Summarizer` | 138 |
| `translate` | `Translator` | 138 |
| `detectLanguage` | `LanguageDetector` | 138 |
| `availability` | feature detect | — |

Native create options are passed through (`type`/`format`/`length` for Summarizer, `initialPrompts`/`expectedInputs` for Prompt, language pairs for Translator).

`translate` requires `sourceLanguage` and `targetLanguage`.

### How it fits in the monorepo

This is an **extended functionality package**. It is not wired into `browserless` core.

## License

**@browserless/ai** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
