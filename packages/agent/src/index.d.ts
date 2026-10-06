import type { Page } from 'puppeteer' with { 'resolution-mode': 'import' }

declare function agent(page: Page, goal: string, options?: agent.Options): Promise<agent.Result>

declare namespace agent {
  type BlockedReason = 'captcha' | 'login_wall' | 'unsupported_surface' | 'step_budget' | 'no_change' | 'stale_target' | 'model_blocked'
  interface Provider { apiKey: string; baseUrl: string; model: string }
  interface TextProvider extends Provider { reasoning?: 'none' | 'low' | 'default' }
  interface Options {
    decisions?: Provider
    text?: TextProvider
    maxSteps?: number
    maxDecisions?: number
    waitMs?: number
    timeout?: number
    signal?: AbortSignal
    fetch?: typeof globalThis.fetch
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
