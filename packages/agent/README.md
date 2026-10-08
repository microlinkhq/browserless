# @browserless/agent

Drive an existing Puppeteer page toward a natural-language goal. The caller owns
navigation, browser setup, screenshots and closing the browser. This package does
not change `@browserless/ai`, which uses Chrome's built-in AI APIs.

Experimental. It has completed a live Wallapop search (see below), but `done`
is the model's own judgment and runs are not fully reliable.

## Usage

Requires Node.js >=24. After the package is published:

```sh
npm install @browserless/agent puppeteer
export AI_GATEWAY_API_KEY=...
```

```js
import puppeteer from 'puppeteer'
import agent from '@browserless/agent'

const browser = await puppeteer.launch()
const page = agent(await browser.newPage())

await page.goto('https://wallapop.com', { waitUntil: 'networkidle2' })
const { status, profiling } = await page.goal('busca el bmw x3 más barato')
if (status === 'success') {
  const { data } = await page.extract('get the search results', {
    products: {
      attr: { name: { type: 'string' }, price: { type: 'number' }, url: { type: 'url' } }
    }
  })
  console.log(data.products)
}
const { accuracy, cost, timing } = await profiling() // optional: one extra request, for accuracy
await browser.close()
```

`agent(page, defaults?)` adds two methods to the Puppeteer page it is given
and returns the same page:

- `page.goal(goal, options?)` drives the page, over as many steps as it takes,
  until the model reports the goal is met.
- `page.extract(...)` returns data from the current page. It does not navigate.

`defaults` apply to both; options passed to a call override them, and an option
passed as `undefined` or `null` keeps the default. The same
functions are exported for use without touching the page: `agent.goal(page, …)`
and `agent.extract(page, …)`.

Import compatibility is CommonJS plus the Node ESM default import, with
TypeScript declarations.

### From the browserless CLI

`browserless exec <file>` from `@browserless/cli` opens a page and passes it to
the function the file exports, so the script does not manage the browser:

```js
const agent = require('@browserless/agent')

module.exports = async ({ page: browserPage, browserless }) => {
  const page = agent(browserPage)
  await browserless.goto(page, { url: 'https://wallapop.com' })
  return page.goal('busca el bmw x3 más barato')
}
```

```sh
browserless exec agent-example.js
```

A goal or an extraction that fails does not throw: the script gets
`status: 'error'` with `error` and decides what to do. The CLI exits with code 1
only when the script itself throws, so a script that should fail the command
throws that `error`.

### Examples

Every file in `examples/` is an exec script: it navigates, gives
the page one or more goals, and returns the extracted data, which the CLI
prints. A goal or an extraction that fails makes the script throw its error. Jev is used through the gateway, so `AI_GATEWAY_API_KEY` is the only
key needed. With `DEBUG=browserless:agent`, each goal also logs one line with
its `status`, `accuracy`, `cost` and `timing`. The examples call `profiling()` for every goal
whether or not the line is printed, so each goal makes the one evaluation
request.

| Script | Steps |
| --- | --- |
| `examples/wallapop.js` | Search `bmw x3`; sort by lowest price; extract the products |
| `examples/wikipedia.js` | Search for an article and open it; extract title and first paragraph |
| `examples/google-flights.js` | Reject cookies if asked; find one-way Zurich to London flights 30 days from today; extract the flights |
| `examples/hacker-news.js` | Open the comments of the first story; extract title, points and comments |
| `examples/github.js` | Open the open issues of this repository; extract them |
| `examples/run.js` | Any page: `--url=<url> --goal=<goal> --extract=<what to get>` |

```sh
browserless exec examples/wallapop.js --no-headless
DEBUG=browserless:agent browserless exec examples/hacker-news.js --no-headless
browserless exec examples/run.js --no-headless --url=https://en.wikipedia.org/wiki/Main_Page --goal='Find and open the Wikipedia article about Alan Turing.' --extract='get the article title'
```

`--no-headless` opens a visible browser window, so every step the agent takes
can be watched. Without it the browser runs headless.

```js
const agent = require('@browserless/agent')
const debug = require('debug-logfmt')('browserless:agent')
const { flat, succeeded } = require('./util')

module.exports = async ({ page, browserless }) => {
  agent(page)

  await browserless.goto(page, { url: 'https://wallapop.com' })
  const searched = await page.goal('busca "bmw x3"')
  debug('search', { status: searched.status, ...flat(await searched.profiling()) })
  succeeded(searched)
  const sorted = await page.goal('ordena los resultados de más barato a más caro')
  debug('sort', { status: sorted.status, ...flat(await sorted.profiling()) })
  succeeded(sorted)

  const { data } = succeeded(
    await page.extract('get the search results', {
      products: {
        attr: { name: { type: 'string' }, price: { type: 'number' }, url: { type: 'url' } }
      }
    })
  )
  return data
}
```

`npm start` runs the Wallapop one. All six were run as shipped on a paid gateway
account and returned data matching their goal: 32 Wallapop products sorted by
lowest price, the Wikipedia title, 48 flights with prices, a Hacker News story
with its points and comments, 4 GitHub issues, and `Alan Turing`. That is a
check that they can work, not a reliability figure. What went wrong along the
way:

- Wikipedia's first paragraph was never extracted: the first `<p>` on the page
  is empty and a rule reads the first match.
- Google Flights shows a cookie consent page in the EU, hence its first goal,
  and navigates with the browserless adblocker off because the adblocker leaves
  that page blank. One of its two final runs failed when the AI SDK refused a
  decision whose chosen option was not the most probable.
- One Wallapop run failed when the gateway took over 25 seconds to answer.
- Model requests are not retried, so one slow or refused answer ends a run.

## API

### `await page.goal(goal, options?)`

Resolves to `{ status, steps, decisions, trace, profiling }`, plus `error` when
`status` is `'error'`:

```js
const { status, error, profiling } = await page.goal('Open the comments page of the first story.')
```

`status` is `'success'` when the model reports visible satisfaction of the goal,
and `'error'` when the run stopped for any other reason; `error` then says why.
`goal` does not throw for a run that fails. It throws only when it is called
wrong: no page, an empty goal, an invalid option, or a goal already running on
the page. Success is a model
judgment, not an independent proof of correctness. Each trace entry has the
operation, snapshot action ID, operation confidence/probabilities, selected
target confidence/probabilities, step/request counts, stale status and whether
the page changed. Text-entry values are recorded too; treat traces as private
data.

Call `profiling` to get what the run cost, how long it took, and a model's
verdict on whether the goal was met. It is there for failed runs too:

```js
const { profiling } = await page.goal('Open the comments page of the first story on the front page.')
const { accuracy, cost, timing } = await profiling()
// example values:
// accuracy → { passed: true, probability: 0.92 }
// cost     → { calls: 4, inputTokens: 8982, outputTokens: 500, cachedInputTokens: 1800,
//              cacheWriteTokens: 600, reasoningTokens: 43, usd: 0.000306424,
//              generationIds: ['gen_01M492ME3C…', …] }
// timing   → { totalMs: 2410, modelMs: 1530, otherMs: 880, evaluationMs: 310 }
```

`cost` and `timing` come from what each model call already returned, with no
extra request: tokens from the AI SDK `usage`, dollars from the AI Gateway
`providerMetadata.gateway.cost`, and `generationIds` to look calls up in the
gateway. `usd`, `inputTokens` and `outputTokens` are `undefined` when any call
did not report them, such as a model outside the gateway, so a total is never
understated. The cache and reasoning breakdowns count only the calls that report
them; decision models report none. `otherMs` is the run time not spent waiting
on a model: observing, acting, settling and waits.

`accuracy` is the one extra request: the `evaluator` model reads the final page,
its fields, and the actions taken, without the run's own DONE, and answers
whether the goal is met. `probability` is its probability that it is. It is a
second model judgment, not ground truth: the default evaluator,
`'typesafe-ai/jev'`, is the same model that takes the decisions by default. Its cost is included in `cost` and its time
in `evaluationMs`, not `totalMs`. Calling `profiling()` sends the page text and typed
values to the evaluator's provider.

The first call runs the evaluation and later calls return the same object. If
the evaluation fails, `profiling()` still resolves with `cost` and `timing`, `accuracy`
is `undefined`, `error` holds the reason, and the next call tries again. Pass
`profiling({ signal })` to cancel it. `JSON.stringify(result)` gives the result
without the function.

When the agent itself stops the run, `error` is an `agent.BlockedError` with
`code: 'BLOCKED'`, `reason` and `trace` (`accuracy` is `undefined` when no page
was observed). Any other failure, such as a model reply that was refused or a
provider that did not answer, is in `error` as it was thrown. The reasons:

| Reason | Meaning |
| --- | --- |
| `captcha` | Visible text suggests human verification; no bypass attempted |
| `login_wall` | A visible password field needs manual login |
| `unsupported_surface` | Unsupported DOM surface, no document body, or popup |
| `step_budget` | Action or decision-request budget exhausted |
| `no_change` | Three consecutive successful actions left the same observation. An action that changed nothing is not offered again until the page changes |
| `stale_target` | Three consecutive decisions chose the same target and it failed its freshness check each time |
| `model_blocked` | The provider selected BLOCKED |

Malformed responses, network/provider failures and aborts resolve with
`status: 'error'` and the original error in `error`; they never become invented
successful results. Something thrown that is not an `Error` is wrapped in one,
with the original as its `cause`. Invalid configuration rejects before the run
starts.
Stale decisions are discarded and re-observed without spending an action, but
each decision still spends a request.

| Option | Default | Meaning |
| --- | --- | --- |
| `decisions` | `'typesafe-ai/jev'` | Decision model: an AI Gateway model id or an AI SDK decision model. `false` makes the text model take the decisions |
| `text` | `'openai/gpt-6-luna'` | Language model: an AI Gateway model id or an AI SDK language model. Writes the value for TYPE_TEXT, and makes the decisions when `decisions` is `false` |
| `evaluator` | `'typesafe-ai/jev'` | Decision model that `profiling()` asks whether the goal was met: an AI Gateway model id or an AI SDK decision model |
| `reasoning` | `'none'` | Reasoning level for the text model: `provider-default`, `none`, `minimal`, `low`, `medium`, `high` or `xhigh` |
| `maxSteps` | `60` | Maximum successful input actions |
| `maxDecisions` | `120` | Maximum decision requests, including discarded stale decisions |
| `waitMs` | `100` | Duration of WAIT, accepts zero |
| `timeout` | `25000` | Milliseconds per model request |
| `signal` | none | AbortSignal; checked before decisions and input |

The default text model needs paid AI Gateway credits; the gateway's free tier
refuses `openai/gpt-6-luna`. On the free tier pass a model it allows, for
example `text: 'zai/glm-5.3-flash'`, at 5 requests per minute.

Model requests are never retried: this keeps request accounting exact. A reply
that arrives after `timeout` is discarded even if the model ignored the abort. A final
DONE observation can succeed after the last permitted action; no extra input is
allowed. Concurrent agent calls on the same Page are rejected.

### `await page.extract(rules | instruction, options?)`

Data comes out of the page through rules, in the format of the Microlink
[`data`](https://microlink.io/docs/api/parameters/data) parameter. A rule has:

| Property | Meaning |
| --- | --- |
| `selector` | CSS selector for one element |
| `selectorAll` | CSS selector for every matching element; the field is a list |
| `attr` | What to read: `text`, `html` (default), `val`, `href`, `src`, any attribute name, a list of those to try in order, or an object of nested rules relative to the matched element |
| `type` | `number`, `url`, `image`, `date` or `string`. Without a type, text that is exactly a number or `true`/`false` is converted and everything else stays a string |

`extract` can be called at three levels:

```js
// 1. Rules: no model involved.
await page.extract({
  stories: {
    selectorAll: '.athing',
    attr: {
      title: { selector: '.titleline > a', attr: 'text' },
      href: { selector: '.titleline > a', attr: 'href', type: 'url' }
    }
  }
})

// 2. Instruction: the model writes the rules, then they run.
await page.extract('get the stories with their title and link')

// 3. Instruction plus rules without selectors: you name the fields and types, the model fills in the selectors.
await page.extract('get the stories', {
  stories: { attr: { title: { type: 'string' }, href: { type: 'url' } } }
})
```

Options go last: `page.extract(rules, options?)` and
`page.extract(instruction, rules?, options?)`. Rules passed with an instruction
that already have a selector for every field run as they are, with no model
request. Options passed where the rules belong throw.

`extract` resolves to `{ status, data, profiling }`, or to
`{ status: 'error', error, profiling }` when it failed:

```js
const { status, data, error, profiling } = await page.extract('get the stories', {
  stories: { attr: { title: { type: 'string' }, href: { type: 'url' } } }
})
const { rules, cost, timing } = await profiling()
```

Like `goal`, it does not throw for an extraction that fails, only when it is
called wrong: no page, an empty instruction, an invalid option next to an
instruction, or rules the built-in engine cannot run. Rules passed on their own
to a custom engine are not checked here; rules passed with an instruction always
are, since this package fills them in. `data` is whatever the rules engine
returned.
`rules` are the rules that ran, so the ones a model wrote can be stored and
passed to `page.extract(rules)` next time without a request. `cost` and
`timing` have the same fields as for `goal`; with rules of your own they report
no request and no cost. `profiling` makes no extra request and has no
`accuracy`.

The values always come from the DOM. A language model only ever writes
selectors, so it cannot invent a value: a wrong selector gives a missing field,
`null` inside a list item, or the wrong element's text.

How rules are written:

- One request to the language model in `text`; `reasoning`, `timeout` and
  `signal` apply. It receives an outline of the page: tags, ids, classes,
  `data-*` and a few other attributes, and short text, indented by nesting. Of
  several similar siblings it sees the first three and a count of the rest.
  The outline is taken once it has stopped changing, waiting up to 3 seconds,
  and is capped at 60,000 characters.
- A rule the model writes without `attr` reads the text, not the HTML.
- Rules from the model may only contain `selector`, `selectorAll`, `attr` and
  `type`. Anything else, including `evaluate`, is rejected, so a model never
  supplies code.
- With rules of your own, the result has exactly your field names and nesting. A rule you
  wrote with its own selector is kept untouched; otherwise the model supplies
  the selector, your `type` and `attr` win over the model's, and a reply that
  omits a field or nests where you did not is an error.
- The model sees only what the outline shows: text is clipped at 80
  characters, and of several siblings with the same classes and the same
  children it sees three.
- The rules are tried on the page with the built-in engine before they are
  returned. An invalid selector is the error
  `The model did not write usable extraction rules.` and rules that give no
  value at all are `The rules the model wrote matched nothing on the page.`
- A selector can still be wrong for one field, or brittle. On Wallapop the model
  used generated class names such as `retrieval-item-card-module_…__ckj4h`,
  which will break when the site is rebuilt. An instruction like "top 5" is not
  honored: rules select every match.

The engine that runs rules is replaceable:

```js
agent(page, { extractor: (page, rules) => myEngine(page, rules) })
```

When the page already has an `extract` method, as it does inside a Microlink
function, `agent(page)` keeps it and uses it as the engine. Otherwise a small
built-in engine evaluates the rules in the page (`agent.applyRules`). It follows
the Microlink rule format for the properties above, with these differences:

- No `evaluate` rules, and `type` is one name, not a name with options.
- It reads the live DOM, not the fetched HTML, and does not look inside shadow
  roots.
- Selectors are plain CSS: jQuery extensions such as `:contains()` and `:eq()`
  are invalid.
- A rule without a selector reads the rendered text or the HTML of the whole
  page; there is no readability pass, Markdown or JSON mode.
- `number` reads the first number in the text and accepts `.` or `,` as decimal
  or thousands separator, decided by position: `16.690 €` is 16690, `1.234,50`
  is 1234.5, `4.5` is 4.5, `0.125` is 0.125. A single separator followed by
  exactly three digits is read as thousands, so `3.142` is 3142.
- `date` returns an ISO string and needs a four-digit year in the text.
- Only `number`, `url`, `image`, `date` and `string` are known types.

## Models

Both model calls go through the [AI SDK](https://ai-sdk.dev) (`ai`). A model id
string is resolved by [Vercel AI Gateway](https://vercel.com/docs/ai-gateway),
which reads `AI_GATEWAY_API_KEY`:

```js
const page = agent(await browser.newPage(), {
  decisions: 'typesafe-ai/jev',
  text: 'openai/gpt-6-luna'
})
```

Those two are the defaults, so `agent(page)` does the same.

Any AI SDK model instance works too, so a provider can be called directly with
its own key. This runs Jev on a TypeSafe key and keeps the gateway for text:

```js
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai'

const typesafe = createTypeSafeAi({ apiKey: process.env.TYPESAFE_API_KEY })

const page = agent(await browser.newPage(), {
  decisions: typesafe.decisionModel('jev-latest')
})
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

### Without a decision model

With `decisions: false`, the language model in `text` receives the
same state and the same questions and returns `{ "operation", "target" }`. The
operation must be one of the offered operations and the target one of the
targets offered for it, or the run stops before any input. A target sent for an
operation that has none, such as WAIT or DONE, is ignored. There are no
probabilities on this path, so `confidence` and `probabilities` are absent from
the trace.

```js
await page.goal(goal)                       // Jev decides
await page.goal(goal, { decisions: false }) // language model decides
```

Every trace entry has `decisionMs`, the time its decision took (the model
request plus building and checking it), and `textMs` when a value was generated,
so the two setups can be compared on the same goal.

### Benchmark

`scripts/benchmark.js` runs the goal live with Jev, records every decision
request, and replays the same requests to Jev and to each language model, so
every decider answers identical inputs. It needs `TYPESAFE_API_KEY` and
`AI_GATEWAY_API_KEY`:

```sh
npm run benchmark -- --samples=10 --models=amazon/nova-micro,mistral/mistral-nemo
```

`--perMinute` (default 5) paces each language model for the gateway's free
tier. Result of one run on the Wallapop goal, 10 requests recorded from two live
Jev runs that both ended on the results sorted by lowest price:

| Decider | Answered | Median | p90 | Same operation as Jev | Same operation and target |
| --- | --- | --- | --- | --- | --- |
| `jev-latest` (direct) | 10/10 | 254 ms | 284 ms | reference | reference |
| `amazon/nova-micro` | 8/10 | 694 ms | 959 ms | 2 | 1 |
| `alibaba/qwen3.7-flash` | 7/10 | 1421 ms | 1666 ms | 6 | 6 |
| `mistral/mistral-nemo` | 10/10 | 1336 ms | 3291 ms | 5 | 2 |

The unanswered requests were free-tier rate-limit errors. Agreement with Jev is
not correctness: it shows how often a model picked the step of a run that is
known to have worked. These are the small models the free tier allows, one run
each; larger models were not measured.

### Compare models

`scripts/compare.js` runs one task several times with each model setup, each
run in a fresh browser context, and ranks the setups:

```sh
DEBUG=browserless:agent:compare npm run compare -- \
  --url=https://news.ycombinator.com \
  --goal='Open the comments page of the first story on the front page.' \
  --extract='get the story title and its points' \
  --decisions=typesafe-ai/jev,none \
  --text=openai/gpt-6-luna,zai/glm-5.3-flash \
  --runs=5
```

`--decisions` and `--text` take comma-separated model ids and every decision
model is paired with every text model; `none` makes the text model take the
decisions. `--reasoning` takes comma-separated reasoning levels for the text
model (default `none`) and each level is one more setup per pair of models, so
`--reasoning=none,low` measures whether reasoning helps, and a model that
refuses `none` can be run with `minimal`. An unknown level is refused before
any run. `--goal` can be repeated for goals
that run one after another.
`--extract` is optional. `--out=<file.jsonl>` chooses where the records go;
the default is a new file in the temporary directory, printed as `file`.

One JSON line is appended per run, and with `DEBUG` set the same record is
logged as it finishes:

| Field | Meaning |
| --- | --- |
| `decisions`, `text`, `reasoning`, `run` | The setup and the run number |
| `status`, `error`, `goalsDone` | `done`, or the `BlockedError` reason, or `error` for anything else, including a run that could not start; how many goals finished |
| `navigationError` | Present when loading `--url` reported an error, such as a timeout. The run continues on whatever loaded |
| `path` | The operations and targets that ran, such as `CLICK e17 > DONE`; goals are separated by a vertical bar |
| `decisionRequests`, `staleDecisions`, `actionsWithoutPageChange` | How much work the run took and how much of it was wasted |
| `minConfidence` | The lowest confidence of any decision, in the operation or in its target; absent when the text model decides |
| `passed`, `probability` | The evaluator's judgment from `profiling()`: `passed` needs every goal judged met, `probability` is the lowest. Absent when the run did not finish or a goal was not judged |
| `calls`, `inputTokens`, `outputTokens`, `usd` | Cost of the goals from `profiling()`, which includes the evaluator's request, plus the extraction request with `--extract`. Absent when any request did not report it |
| `totalMs`, `modelMs` | Time of the goals from `profiling()`, without the evaluator's request |
| `finalUrl` | Where the run ended |
| `extracted`, `extractError`, `extractMs`, `extractUsd`, `dataValues`, `dataHash` | With `--extract`, after every goal finished: whether it returned at least one value, how many non-empty values, and a hash of the data that ignores key order |

The printed `ranking` has one entry per setup, best first: by `doneRate`, then
`passRate` (the share of all runs that finished and were judged met;
`judgedRuns` says how many were judged at all), then `pathAgreement` (the share
of finished runs that took the most common path), then `p90TotalMs`, then
`medianUsd`. `p90TotalMs` is the time that nine in ten finished runs did not
exceed; with fewer than ten finished runs it is the slowest one. `dataAgreement` is the
share of extractions that returned the most common data. Medians and
`p90TotalMs` cover finished runs only, and each is absent when no run finished
or one of them did not report the number. `totalUsd` is what every run of the setup cost, failed
ones included, and the `totalUsd` next to `ranking` is the cost of the whole
comparison; both are absent when any run did not report its cost. `reportedUsd` is the sum of the costs that
were reported and `runsWithoutCost` counts the runs that reported none, such
as a run that ended on an error. A run that fails is recorded and the remaining
runs go on.

Results of past comparisons are collected in [scripts/README.md](scripts/README.md).

What it does not measure: whether a finished run is correct. `passed` is a
second model's opinion, and on the same
path and final page it has answered both yes and no.

### Text values

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
The upstream license is reproduced at the end of this section.
The Node executor/client are ports, not a Python wrapper: they use the caller's
Puppeteer Page without Browser Harness, a separate Python process or another
browser. No model weights or inference service are bundled.

<details>
<summary>browser-use/jev-ultrafast license</summary>

```
MIT License

Copyright (c) 2026 Browser Use

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>
