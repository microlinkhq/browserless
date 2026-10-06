# @browserless/agent

Drive an existing Puppeteer page toward a natural-language goal. The caller owns
navigation, browser setup, screenshots and closing the browser. This package does
not change `@browserless/ai`, which uses Chrome's built-in AI APIs.

Experimental: the offline contract tests pass, but no real provider or Wallapop
acceptance run has been performed. Do not treat this README as evidence that
Wallapop works.

## Usage

Requires Node.js >=24 and browserless >=13. After the package is published:

```sh
npm install @browserless/agent browserless puppeteer
```

```js
import puppeteer from 'puppeteer'
import agent from '@browserless/agent'

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://wallapop.com', { waitUntil: 'networkidle2' });
await agent(page, 'busca el bmw x3 más barato')
await page.screenshot({ path: 'wallapop.png' });
await browser.close();
```

Import compatibility is CommonJS plus the Node ESM default import, with
TypeScript declarations.

### From the browserless CLI

`browserless exec <file>` from `@browserless/cli` opens a page and passes it to
the function the file exports, so the script does not manage the browser:

```js
const agent = require('@browserless/agent')

module.exports = async ({ page, browserless }) => {
  await browserless.goto(page, { url: 'https://wallapop.com' })
  const result = await agent(page, 'busca el bmw x3 más barato')
  await page.screenshot({ path: 'wallapop.png' })
  return result
}
```

```sh
browserless exec agent-example.js
```

The CLI prints the returned trace as JSON and exits with code 1 when the agent
throws, including a `BlockedError`. `examples/wallapop.js` is this script; in
this repository `npm start` runs it. It requires decision-provider credentials
and, for any text entry, separate chat-helper configuration.

It has been run live against Wallapop with `jev-latest` for decisions and
`inception/mercury-2.5` through an OpenAI-compatible gateway for text. In the
last five runs, two ended on the results for `bmw x3` sorted by lowest price,
two reported `done` too early (one unsorted, one before results loaded) and one
failed on a text-provider timeout. `done` is the model's judgment, not a
verified outcome.

## API

### `await agent(page, goal, options?)`

Returns `{ status: 'done', steps, decisions, trace }` when the model reports
visible satisfaction of the goal. DONE is a model judgment, not an independent
proof of correctness. Each trace entry has the operation, snapshot action ID,
operation confidence/probabilities, selected target confidence/probabilities,
step/request counts, stale status and whether the page changed. Text-entry
values are recorded too; treat traces as private data.

Throws `agent.BlockedError` with `code: 'BLOCKED'`, `reason`, and `trace` for:

| Reason | Meaning |
| --- | --- |
| `captcha` | Visible text suggests human verification; no bypass attempted |
| `login_wall` | A visible password field needs manual login |
| `unsupported_surface` | Unsupported DOM surface, no document body, or popup |
| `step_budget` | Action or decision-request budget exhausted |
| `no_change` | Three consecutive successful actions left the same observation. An action that changed nothing is not offered again until the page changes |
| `stale_target` | Three consecutive decisions chose the same target and it failed its freshness check each time |
| `model_blocked` | The provider selected BLOCKED |

Configuration, malformed responses, network/provider failures and aborts reject
with their original errors; they do not become invented successful results.
Stale decisions are discarded and re-observed without spending an action, but
each decision still spends a request.

| Option | Default | Meaning |
| --- | --- | --- |
| `decisions` | TypeSafe env configuration | `{ apiKey, baseUrl, model }` |
| `text` | Text-helper env configuration | `{ apiKey, baseUrl, model }`, only used for TYPE_TEXT |
| `maxSteps` | `60` | Maximum successful input actions |
| `maxDecisions` | `120` | Maximum decision requests, including discarded stale decisions |
| `waitMs` | `100` | Duration of WAIT, accepts zero |
| `timeout` | `25000` | Milliseconds per HTTP request |
| `signal` | none | AbortSignal; checked before decisions and input |
| `fetch` | global fetch | Fetch-compatible transport, useful for offline tests |

No automatic HTTP retries: this keeps request accounting exact. A final DONE
observation can succeed after the last permitted action; no extra input is
allowed. Concurrent agent calls on the same Page are rejected.

## Providers

Default decisions configuration:

- `TYPESAFE_API_KEY`: required TypeSafe Bearer token.
- `TYPESAFE_BASE_URL`: defaults to `https://api.typesafe.ai/v1`.
- `TYPESAFE_MODEL`: defaults to `jev-latest`.

The code sends one POST to `${baseUrl}/systemone`. The body contains `model`,
`state: { page, elements, recent_actions }`, and `questions`. Each question has
`type: 'choice'`, `criteria`, and `instructions`. The response must contain
`answers.operation` and the target head selected by that operation. Each answer
must have `choice`, `confidence`, and a `probabilities` object with exactly the
offered IDs, finite values in [0,1], a sum within 0.02 of 1, and a winning choice.
Unused speculative heads cannot drive input and are deliberately not consumed.

An alternative decisions-compatible provider, including an OpenRouter deployment
that actually exposes this contract, must be explicit:

```js
await agent(page, goal, {
  decisions: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: process.env.OPENROUTER_DECISIONS_BASE_URL,
    model: process.env.OPENROUTER_DECISIONS_MODEL
  },
  text: {
    apiKey: process.env.TEXT_MODEL_API_KEY,
    baseUrl: process.env.TEXT_MODEL_BASE_URL,
    model: process.env.TEXT_MODEL
  }
})
```

A normal OpenRouter chat endpoint is NOT a decisions-compatible endpoint. This
package does not claim that OpenRouter's public API exposes `/systemone`; provide
a compatible base URL or use TypeSafe. No generic chat-to-decisions adapter is
silently inserted.

For the text helper, all of `TEXT_MODEL_API_KEY`, `TEXT_MODEL_BASE_URL` and
`TEXT_MODEL` are required unless `options.text` supplies all three. Reasoning
models can spend the whole 1024-token reply budget thinking and return no
usable value, so the helper asks the provider to turn reasoning off by sending
`reasoning: { enabled: false }`. `TEXT_MODEL_REASONING` or
`options.text.reasoning` changes that: `none` (default), `low` (sends
`reasoning: { effort: 'low' }`) or `default` (sends no reasoning field, for
providers that reject it). Base URLs
must be clean HTTPS URLs. The helper calls `${baseUrl}/chat/completions` only for
TYPE_TEXT. It requests a JSON object and accepts exactly `{ "text": "..." }` with
a nonempty string of at most 2000 characters. Null, extra keys, code fences and
invalid JSON fail closed. No personal information or missing value is guessed
by the executor. API keys are sent only to the configured endpoints; redirects
are rejected. Page text, goals, fields and recent actions leave the browser for
these providers. Use only pages you may disclose to them.

## How it works

1. `page.evaluate` collects visible controls, viewport text, form state and live
   DOM refs. Persistent DOM node IDs, snapshot action IDs (`e1`, `e2`) and model
   indices are separate. At most 250 element actions and 6000 text characters
   are offered per snapshot.
2. One request proposes an operation plus speculative CLICK, TYPE_TEXT, SUBMIT and
   SELECT target heads. The operation chooses which head to consume. The model
   never supplies a selector, JavaScript or screen coordinates.
3. Code resolves the selected node via a retained ElementHandle. Immediately
   before input, it checks node identity, target attributes/value, nearby text,
   same-form values, document identity, current visibility and hit-testing.
   Unrelated changes outside the target context/form are tolerated. Moving
   targets are re-resolved, not clicked at old coordinates. Text entry checks
   again after focus and before inserting text, and requires the target to
   still hold keyboard focus. A discarded stale decision is reported to the
   next decision request as `stale`, so it is not mistaken for executed input.
4. Puppeteer clicks/selects or inserts generated text, or scrolls/waits, then
   collects a new observation. Three unchanged actions stop the loop.

There is no confidence threshold in v0. A finite action space prevents arbitrary
model-emitted code, but does NOT ensure that the chosen action is correct or
harmless. Do not use this autonomous prototype for purchases, sending messages,
deleting data or other irreversible actions without your own approval layer.
It is not a permission policy or a CAPTCHA-solving system.

## Limits

Single top-level page only. Open shadow roots are traversed: their controls and
text are observed, slotted content names the control it is slotted into, and
hit-testing and focus checks follow the composed tree. Visible iframes, canvas,
file inputs and password inputs, in the light DOM or inside open shadow roots,
conservatively stop the entire run, even if they are unrelated to the goal.
The same-form and nearby-text freshness guards do not see changes inside shadow
roots, a `:host::after` overlay is not detected as a cover, and actions are
listed root by root, so the 250-action cap can drop shadow controls on very
large pages. Closed shadow roots cannot be detected from JS: their content is
invisible to the agent and never blocks or receives input. Popup tabs are reported, never
followed or automatically closed. A popup may already have opened before it can
be detected.

Login detection is limited to visible password fields, while CAPTCHA detection
is a text heuristic. Other login/challenge walls may end as model_blocked or
no_change. False positives are possible. There is no image/vision fallback,
multi-tab planner, hidden/offscreen target support, native browser dialog handler
or independent goal verifier. Control truncation, unsupported custom roles,
long context truncated at 6000 characters and asynchronous browser input races
remain v0 limits. Guards reduce stale-target risk, not all browser races.

## Verification and publishing

`npm test` runs AVA with mocked model responses, a fake Puppeteer adapter and
jsdom DOM fixtures. No API key is needed for these tests. jsdom provides
synthetic visibility/layout, so `test/chrome.js` also runs text entry against
the Chrome that Puppeteer downloads: value replacement in inputs and editing
hosts, and the keyboard-focus guard. Clicks, selects, scrolling and the full
loop are not exercised in real Chrome. No paid-provider benchmark is claimed.

This directory is picked up by the existing `packages/*` workspace and release
globs. No CI, root config or existing package is changed. The owner must publish
`@browserless/agent` to npm with public access after review. No publishing or
merging is performed by this patch.

## Attribution

The collector and finite-choice/speculative-head pattern are adapted from
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast), commit
`1231850a0bf1a0c0341fe408ef1668dbbfdfac46`, MIT, copyright 2026 Browser Use.
`LICENSE.jev` includes the full upstream license and is shipped in the package.
The Node executor/client are ports, not a Python wrapper: they use the caller's
Puppeteer Page without Browser Harness, a separate Python process or another
browser. No model weights or inference service are bundled.
