# Measuring models

Two scripts measure the models behind `@browserless/agent`. Both run through
`browserless exec` and need `AI_GATEWAY_API_KEY`.

| Script | Question it answers | How |
| --- | --- | --- |
| `compare.js` | Which model setup completes a task best? | Runs the whole task live, several times per setup, each run in a fresh browser context |
| `benchmark.js` | How fast does a model answer one decision, and does it agree with Jev? | Records the decision requests of a live Jev run and replays the same requests to every model. Also needs `TYPESAFE_API_KEY` |

The flags and the fields of every record are described in the
[package README](../README.md#compare-models).

## Running a comparison

```sh
DEBUG=browserless:agent:compare npm run compare -- \
  --url=https://en.wikipedia.org/wiki/Main_Page \
  --goal='Search for "Alan Turing" and open the Wikipedia article about him.' \
  --extract='get the article title' \
  --decisions=typesafe-ai/jev,none \
  --text=openai/gpt-6-luna,zai/glm-5.3-flash \
  --runs=5 \
  --out=results.jsonl
```

Choose a task that uses the model being compared. The text model is only called
to write a typed value, to write extraction rules, and to take the decisions
when `--decisions=none`. A goal that only clicks, with Jev deciding, never
calls the text model, so every text model gets the same result.

## Reading the tables

| Column | Meaning |
| --- | --- |
| Done | Runs where the model reported the goal done |
| Passed | Runs that finished and that the evaluator judged as met |
| Same path | Share of finished runs that took the most common sequence of actions |
| Decisions | Median decision requests of the finished runs |
| Median ms | Time that half of the finished runs did not exceed. Computed from the run records; the script prints p90 only |
| p90 ms | Time that nine in ten finished runs did not exceed. With fewer than ten finished runs it is the slowest one |
| Total usd | Cost of every run of the setup. Entries up to 2026-10-06 exclude the extraction request; later ones include it. `not reported` when a failed run reported no cost |
| Extracted | Runs where the extraction returned at least one value |

Rows are ordered as the script ranks them: done, passed, same path, p90.

## Results

Add each new comparison below with its date, command and tables, newest first.
Prices and models change, so an entry is only valid for its date.

### 2026-10-06: the three leading text models and `gpt-5-nano`, 10 runs

100 runs, 10 per setup, same Wikipedia task as the entry below. Reported cost:
0.1294 usd over 79 runs; 21 failed runs reported none. Extraction cost is not
included.

```sh
npm run compare -- \
  --url=https://en.wikipedia.org/wiki/Main_Page \
  --goal='Search for "Alan Turing" and open the Wikipedia article about him.' \
  --extract='get the article title' \
  --decisions=typesafe-ai/jev,none \
  --text=openai/gpt-6-luna,zai/glm-5.3-flash,alibaba/qwen3.8-flash \
  --runs=10

npm run compare -- \
  --url=https://en.wikipedia.org/wiki/Main_Page \
  --goal='Search for "Alan Turing" and open the Wikipedia article about him.' \
  --extract='get the article title' \
  --decisions=typesafe-ai/jev,none \
  --text=openai/gpt-5-nano \
  --reasoning=minimal,low \
  --runs=10
```

**`typesafe-ai/jev` decides; the text model types and writes the extraction rules**

| Text model | Reasoning | Done | Passed | Same path | Decisions | Median ms | p90 ms | Total usd | Extracted | Failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `zai/glm-5.3-flash` | none | 10/10 | 10/10 | 100% | 4 | 3668 | 4406 | 0.01636 | 10/10 | |
| `openai/gpt-5-nano` | minimal | 10/10 | 10/10 | 100% | 4 | 4558 | 6740 | 0.01566 | 10/10 | |
| `openai/gpt-5-nano` | low | 10/10 | 10/10 | 100% | 4 | 6149 | 7491 | 0.01600 | 10/10 | |
| `alibaba/qwen3.8-flash` | none | 10/10 | 10/10 | 100% | 4 | 4109 | 10633 | 0.01647 | 10/10 | |
| `openai/gpt-6-luna` | none | 9/10 | 9/10 | 100% | 4 | 4395 | 10580 | not reported | 9/10 | 1 no valid typed value |

**The text model decides everything (`--decisions=none`)**

| Text model | Reasoning | Done | Passed | Same path | Decisions | Median ms | p90 ms | Total usd | Extracted | Failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `zai/glm-5.3-flash` | none | 10/10 | 10/10 | 90% | 4 | 6666 | 12921 | 0.02158 | 10/10 | |
| `openai/gpt-6-luna` | none | 10/10 | 10/10 | 80% | 4 | 8574 | 10142 | 0.01002 | 10/10 | |
| `alibaba/qwen3.8-flash` | none | 10/10 | 10/10 | 40% | 4 | 9115 | 20334 | 0.01888 | 10/10 | |
| `openai/gpt-5-nano` | minimal | 0/10 | 0/10 | | | | | not reported | 0/10 | 10 invalid decisions |
| `openai/gpt-5-nano` | low | 0/10 | 0/10 | | | | | not reported | 0/10 | 10 invalid decisions |

What it shows:

- With Jev deciding, `zai/glm-5.3-flash` is the steadiest: every run finished,
  none took longer than 5 seconds. `openai/gpt-6-luna` and
  `alibaba/qwen3.8-flash` each had two runs above 10 seconds, and
  `openai/gpt-6-luna` failed one run because its typed value was refused.
- With ten runs p90 now separates what the median hides: the three medians are
  within 0.8 seconds, the p90 values are 4.4, 10.6 and 10.6 seconds.
- As the decider, all three finished every run. `openai/gpt-6-luna` cost half
  as much as `zai/glm-5.3-flash`; `alibaba/qwen3.8-flash` took a different
  path in 6 of 10 runs.
- `openai/gpt-5-nano` works once `--reasoning` is not `none`: as the typist it
  finished every run, slower than the others, and `low` was slower than
  `minimal` with no gain. As the decider it never returned a valid decision,
  at either level.

Limits: one task, one site, one day.

### 2026-10-06: eight low-cost text models on Wikipedia

80 runs, 5 per setup. Reported cost of the 60 runs that reported one: 0.2445 usd.

```sh
npm run compare -- \
  --url=https://en.wikipedia.org/wiki/Main_Page \
  --goal='Search for "Alan Turing" and open the Wikipedia article about him.' \
  --extract='get the article title' \
  --decisions=typesafe-ai/jev,none \
  --text=openai/gpt-6-luna,zai/glm-5.3-flash,alibaba/qwen3.8-flash,deepseek/deepseek-v4-flash,google/gemini-2.5-flash-lite,inception/mercury-2.5,nvidia/nemotron-3.5-lightning,openai/gpt-5-nano \
  --runs=5
```

Gateway prices that day, in usd per million tokens:

| Model | Input | Output |
| --- | --- | --- |
| `openai/gpt-6-luna` | 0.10 | 0.50 |
| `zai/glm-5.3-flash` | 0.15 | 0.50 |
| `alibaba/qwen3.8-flash` | 0.15 | 0.47 |
| `deepseek/deepseek-v4-flash` | 0.13 | 0.26 |
| `google/gemini-2.5-flash-lite` | 0.10 | 0.40 |
| `openai/gpt-5-nano` | 0.05 | 0.40 |
| `nvidia/nemotron-3.5-lightning` | 0.05 | 0.20 |
| `inception/mercury-2.5` | 0.04 | 0.15 |

**`typesafe-ai/jev` decides; the text model types and writes the extraction rules**

| Text model | Done | Passed | Same path | Decisions | p90 ms | Total usd | Extracted | Failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `zai/glm-5.3-flash` | 5/5 | 5/5 | 100% | 4 | 4326 | 0.00818 | 5/5 | |
| `alibaba/qwen3.8-flash` | 5/5 | 5/5 | 100% | 4 | 4664 | 0.00823 | 5/5 | |
| `openai/gpt-6-luna` | 5/5 | 5/5 | 100% | 4 | 5537 | 0.00800 | 5/5 | |
| `deepseek/deepseek-v4-flash` | 5/5 | 5/5 | 100% | 4 | 8099 | 0.00851 | 5/5 | |
| `google/gemini-2.5-flash-lite` | 5/5 | 5/5 | 80% | 4 | 12946 | 0.01021 | 5/5 | |
| `inception/mercury-2.5` | 5/5 | 5/5 | 80% | 4 | 16446 | 0.00991 | 5/5 | |
| `nvidia/nemotron-3.5-lightning` | 4/5 | 4/5 | 100% | 4 | 3412 | not reported | 4/5 | 1 gateway timeout |
| `openai/gpt-5-nano` | 0/5 | 0/5 | | | | not reported | 0/5 | 5 refused requests |

**The text model decides everything (`--decisions=none`)**

| Text model | Done | Passed | Same path | Decisions | p90 ms | Total usd | Extracted | Failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `openai/gpt-6-luna` | 5/5 | 5/5 | 100% | 4 | 9070 | 0.00468 | 5/5 | |
| `zai/glm-5.3-flash` | 5/5 | 5/5 | 80% | 4 | 12035 | 0.01179 | 5/5 | |
| `alibaba/qwen3.8-flash` | 5/5 | 5/5 | 60% | 4 | 9537 | 0.00772 | 5/5 | |
| `deepseek/deepseek-v4-flash` | 5/5 | 4/5 | 40% | 4 | 14502 | 0.01171 | 5/5 | |
| `inception/mercury-2.5` | 2/5 | 2/5 | 100% | 4 | 7304 | not reported | 2/5 | 3 invalid decisions |
| `google/gemini-2.5-flash-lite` | 2/5 | 1/5 | 50% | 44 | 75386 | not reported | 1/5 | 2 step budget, 1 invalid decision |
| `nvidia/nemotron-3.5-lightning` | 0/5 | 0/5 | | | | not reported | 0/5 | 5 invalid decisions |
| `openai/gpt-5-nano` | 0/5 | 0/5 | | | | not reported | 0/5 | 5 refused requests |

What it shows:

- With Jev deciding, `zai/glm-5.3-flash`, `alibaba/qwen3.8-flash` and
  `openai/gpt-6-luna` are tied: every run finished on the same path at the same
  cost. Their p90 times differ by less than one slow request.
- As the decider, `openai/gpt-6-luna` is the only model that finished every run
  on one path, and at the lowest cost of the eight.
- A run with Jev deciding takes about half the time: 4 to 6 seconds for the
  models that finished on one path, against 9 to 14 with a text model deciding.

Why runs failed:

- `openai/gpt-5-nano`: the gateway refuses `reasoning: 'none'` for this model.
  This is a setting the script cannot change yet, not a measure of the model.
- Invalid decisions: the model's answer was not valid JSON for the decision
  schema, and requests are not retried.
- `google/gemini-2.5-flash-lite` as the decider typed "Alan Turing" again and
  again until the budget ran out. One such run cost 0.086 usd, about 50 times a
  normal run.

Limits:

- One task and 5 runs per setup. p90 is the slowest run here.
- The two 80% paths under Jev are Jev clicking further after the article was
  open. The typed text was the same in every run, so they say nothing about the
  text model.

### 2026-10-06: deciders on Hacker News

12 runs, 3 per setup. The goal only clicks, so with Jev deciding the text model
is never called and both Jev rows measure Jev alone.

```sh
npm run compare -- \
  --url=https://news.ycombinator.com \
  --goal='Open the comments page of the first story on the front page.' \
  --extract='get the story title and its points' \
  --decisions=typesafe-ai/jev,none \
  --text=openai/gpt-6-luna,zai/glm-5.3-flash \
  --runs=3
```

| Decisions | Text model | Done | Passed | Same path | Decisions | p90 ms | Total usd | Extracted | Failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `typesafe-ai/jev` | `openai/gpt-6-luna` | 3/3 | 1/3 | 100% | 3 | 3371 | 0.00429 | 3/3 | |
| `typesafe-ai/jev` | `zai/glm-5.3-flash` | 3/3 | 0/3 | 100% | 3 | 3270 | 0.00429 | 3/3 | |
| none | `zai/glm-5.3-flash` | 3/3 | 0/3 | 100% | 2 | 3195 | 0.00602 | 3/3 | |
| none | `openai/gpt-6-luna` | 0/3 | 0/3 | | | | not reported | 0/3 | 3 invalid decisions |

What it shows:

- Jev took three decisions (`CLICK`, `CLICK`, `DONE`) where
  `zai/glm-5.3-flash` took two for the same goal.
- The evaluator judged 1 of 9 finished runs as met, including runs that ended
  on the right page. On this goal `Passed` is not a usable signal.
- `openai/gpt-6-luna` as the decider added text after its JSON answer, so the
  answer was refused. A direct probe of the same request saw it in 1 of 6 calls.

### Decision latency, replayed requests

The `benchmark.js` result is in the
[package README](../README.md#benchmark): 10 decision requests recorded on the
Wallapop goal and replayed to Jev and three small language models.
