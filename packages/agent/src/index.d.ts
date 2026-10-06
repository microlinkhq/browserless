import type { Page } from 'puppeteer' with { 'resolution-mode': 'import' }
import type { Experimental_DecisionModel, FlexibleSchema, LanguageModel } from 'ai' with { 'resolution-mode': 'import' }

declare function agent<PAGE extends Page>(page: PAGE, defaults?: agent.Options): PAGE & agent.Methods

declare namespace agent {
  type BlockedReason = 'captcha' | 'login_wall' | 'unsupported_surface' | 'step_budget' | 'no_change' | 'stale_target' | 'model_blocked'
  type Reasoning = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  interface Methods {
    goal(goal: string, options?: Options): Promise<Result>
    extract<OUTPUT>(instruction: string, schema: FlexibleSchema<OUTPUT>, options?: Options): Promise<OUTPUT>
  }
  function goal(page: Page, goal: string, options?: Options): Promise<Result>
  function extract<OUTPUT>(page: Page, instruction: string, schema: FlexibleSchema<OUTPUT>, options?: Options): Promise<OUTPUT>
  interface Options {
    decisions?: Experimental_DecisionModel
    text?: LanguageModel
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
  interface Result { status: 'done'; steps: number; decisions: number; trace: TraceEntry[] }
  class BlockedError extends Error {
    constructor(reason: BlockedReason, message: string, trace?: TraceEntry[])
    code: 'BLOCKED'
    reason: BlockedReason
    trace: TraceEntry[]
  }
}

export = agent
