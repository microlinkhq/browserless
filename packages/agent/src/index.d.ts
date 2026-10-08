import type { Page } from 'puppeteer' with { 'resolution-mode': 'import' }
import type { Experimental_DecisionModel, LanguageModel } from 'ai' with { 'resolution-mode': 'import' }

declare function agent<PAGE extends Page>(page: PAGE, defaults?: agent.Options): PAGE & agent.Methods

declare namespace agent {
  type BlockedReason = 'captcha' | 'login_wall' | 'unsupported_surface' | 'step_budget' | 'no_change' | 'stale_target' | 'model_blocked'
  type Reasoning = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  interface Rule {
    selector?: string | string[]
    selectorAll?: string | string[]
    attr?: string | string[] | Rules
    type?: string
  }
  type Rules = Record<string, Rule | Rule[]>
  type Data = Record<string, unknown>
  type Extractor = (page: Page, rules: Rules) => Promise<Data>
  interface Methods {
    goal(goal: string, options?: Options): Promise<Result>
    extract(rules: Rules, options?: Options): Promise<Extracted>
    extract(instruction: string, rules?: Rules, options?: Options): Promise<Extracted>
  }
  function goal(page: Page, goal: string, options?: Options): Promise<Result>
  function extract(page: Page, rules: Rules, options?: Options): Promise<Extracted>
  function extract(page: Page, instruction: string, rules?: Rules, options?: Options): Promise<Extracted>
  const applyRules: Extractor
  interface Options {
    extractor?: Extractor
    decisions?: Experimental_DecisionModel | false
    text?: LanguageModel
    evaluator?: Experimental_DecisionModel
    reasoning?: Reasoning
    maxSteps?: number
    maxDecisions?: number
    waitMs?: number
    timeout?: number
    signal?: AbortSignal
  }
  interface TraceEntry {
    operation: 'CLICK' | 'TYPE_TEXT' | 'SELECT' | 'SUBMIT' | 'SCROLL_UP' | 'SCROLL_DOWN' | 'WAIT' | 'DONE' | 'BLOCKED'
    action?: string
    confidence?: number
    probabilities?: Record<string, number>
    decisionMs: number
    textMs?: number
    targetConfidence?: number
    targetProbabilities?: Record<string, number>
    step: number
    decision: number
    text?: string
    stale?: boolean
    pageChanged?: boolean
  }
  interface Accuracy {
    passed: boolean
    probability: number
  }
  interface Cost {
    calls: number
    inputTokens: number | undefined
    outputTokens: number | undefined
    cachedInputTokens: number
    cacheWriteTokens: number
    reasoningTokens: number
    usd: number | undefined
    generationIds: string[]
  }
  interface Timing {
    totalMs: number
    modelMs: number
    otherMs: number
    evaluationMs: number
  }
  interface Profiling {
    accuracy: Accuracy | undefined
    cost: Cost
    timing: Timing
    error?: Error
  }
  interface ProfilingOptions {
    signal?: AbortSignal
  }
  type ProfilingFunction = (options?: ProfilingOptions) => Promise<Profiling>
  interface Run {
    steps: number
    decisions: number
    trace: TraceEntry[]
    profiling: ProfilingFunction
  }
  type Result = (Run & { status: 'success' }) | (Run & { status: 'error'; error: Error })
  interface ExtractProfiling {
    rules: Rules | undefined
    cost: Cost
    timing: Timing
  }
  type ExtractProfilingFunction = () => Promise<ExtractProfiling>
  type Extracted =
    | { status: 'success'; data: Data; profiling: ExtractProfilingFunction }
    | { status: 'error'; error: Error; profiling: ExtractProfilingFunction }
  class BlockedError extends Error {
    constructor(reason: BlockedReason, message: string, trace?: TraceEntry[])
    code: 'BLOCKED'
    reason: BlockedReason
    trace: TraceEntry[]
  }
}

export = agent
