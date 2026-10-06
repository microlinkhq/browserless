import type { Page } from 'puppeteer' with { 'resolution-mode': 'import' }
import type { Experimental_DecisionModel, LanguageModel } from 'ai' with { 'resolution-mode': 'import' }

declare function agent(page: Page, goal: string, options?: agent.Options): Promise<agent.Result>

declare namespace agent {
  type BlockedReason = 'captcha' | 'login_wall' | 'unsupported_surface' | 'step_budget' | 'no_change' | 'stale_target' | 'model_blocked'
  type Reasoning = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
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
    confidence: number
    probabilities: Record<string, number>
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
