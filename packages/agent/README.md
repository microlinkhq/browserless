# @browserless/agent

Drive an existing Puppeteer page toward a natural-language goal. The caller owns
navigation, browser setup, screenshots and closing the browser. This package does
not change `@browserless/ai`, which uses Chrome's built-in AI APIs.

Experimental. It has completed a live Wallapop search (see below), but `done`
is the model's own judgment and runs are not fully reliable.

## Usage

Requires Node.js >=24 and browserless >=13. After the package is published:

```sh
npm install @browserless/agent browserless puppeteer
export AI_GATEWAY_API_KEY=...
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
this repository `npm start` runs it. It needs `AI_GATEWAY_API_KEY` for the text
model; when `TYPESAFE_API_KEY` is set it calls Jev directly with that key
instead of through the gateway.

It has been run live against Wallapop with `jev-latest` through
`@ai-sdk/typesafe-ai` for decisions and `inception/mercury-2.5` through Vercel
AI Gateway for text. Of the last six runs, five ended on the results for
`bmw x3` sorted by lowest price in 9 to 16 decision requests (3.6 to 5.1 seconds
on the four that were timed), and one failed on a text-model timeout. Earlier builds also
reported `done` before results had loaded or been sorted. `done` is the model's
judgment, not a verified outcome. Decisions through the gateway
(`typesafe-ai/jev`) have not been run: the free gateway tier refuses that model.

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
| `decisions` | `'typesafe-ai/jev'` | Decision model: an AI Gateway model id or an AI SDK decision model |
| `text` | `'inception/mercury-2.5'` | Text model: an AI Gateway model id or an AI SDK language model, only used for TYPE_TEXT |
| `reasoning` | `'none'` | Reasoning level for the text model: `provider-default`, `none`, `minimal`, `low`, `medium`, `high` or `xhigh` |
| `maxSteps` | `60` | Maximum successful input actions |
| `maxDecisions` | `120` | Maximum decision requests, including discarded stale decisions |
| `waitMs` | `100` | Duration of WAIT, accepts zero |
| `timeout` | `25000` | Milliseconds per model request |
| `signal` | none | AbortSignal; checked before decisions and input |

Model requests are never retried: this keeps request accounting exact. A reply
that arrives after `timeout` is discarded even if the model ignored the abort. A final
DONE observation can succeed after the last permitted action; no extra input is
allowed. Concurrent agent calls on the same Page are rejected.

## Models

Both model calls go through the [AI SDK](https://ai-sdk.dev) (`ai`). A model id
string is resolved by [Vercel AI Gateway](https://vercel.com/docs/ai-gateway),
which reads `AI_GATEWAY_API_KEY`:

```js
await agent(page, goal, {
  decisions: 'typesafe-ai/jev',
  text: 'openai/gpt-6-luna'
})
```

Any AI SDK model instance works too, so a provider can be called directly with
its own key. This runs Jev on a TypeSafe key and keeps the gateway for text:

```js
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai'

const typesafe = createTypeSafeAi({ apiKey: process.env.TYPESAFE_API_KEY })

await agent(page, goal, { decisions: typesafe.decisionModel('jev-latest') })
```

The decision model answers typed questions with `experimental_decide`, an AI SDK
API that may still change. One request carries
`state: { page, elements, recent_actions }` and one `choice` question for the
operation plus one per operation that has targets. The AI SDK rejects answers
that miss a question or pick an option that was not offered. This package then
requires, for the operation and for the target head that operation selects, a
`probabilities` object with exactly the offered IDs, finite values in [0,1], a
winning choice and a sum close to 1. The AI SDK already checks the sum against
the rounding the provider declares, and rejects any deviation when none is
declared. This package allows 0.02, widened only for the rounding of a provider
that declares two or more decimals. Unused speculative heads cannot
drive input and are not consumed. `confidence` in the trace is the probability
of the chosen option.

The text model is called with `generateText` and a JSON object output only for
TYPE_TEXT. It must return exactly `{ "text": "..." }` with a nonempty string of
at most 2000 characters. Null, extra keys, arrays, invalid JSON and a reply
with no output fail closed.
Reasoning models can spend the whole 1024-token reply budget thinking and
return no usable value, so reasoning is off unless `reasoning` says otherwise.
No personal information or missing value is guessed by the executor. Page text,
goals, fields and recent actions leave the browser for these providers. Use
only pages you may disclose to them.

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
globs. No CI workflow or root config is changed. `@browserless/cli` gains the
`exec` command and a real test script, so CI now tests that package too. The
owner must publish
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
