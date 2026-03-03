import type { Browser, BrowserContext, HTTPResponse, Page, PDFOptions, Viewport } from 'puppeteer'

export interface BrowserlessOptions {
  timeout?: number
  launchOpts?: LaunchOptions
}

export interface LaunchOptions {
  headless?: boolean | 'new'
  args?: string[]
  executablePath?: string
  timeout?: number
  mode?: 'launch' | 'connect'
  proxyServer?: string
  proxyBypassList?: string[]
  [key: string]: unknown
}

export interface BrowserContextOptions {
  proxyServer?: string
  proxyBypassList?: string[]
  viewport?: Viewport
}

export interface ContextOptions extends BrowserContextOptions {
  retry?: number
  timeout?: number
}

export interface Context {
  respawn: () => void
  context: () => Promise<BrowserContext>
  browser: () => Promise<Browser>
  evaluate: <T>(fn: (page: Page, response?: HTTPResponse | undefined, error?: Error) => T | Promise<T>, gotoOpts?: GotoOptions) => Promise<T>
  goto: (page: Page, url: string, opts?: GotoOptions) => Promise<GotoResult>
  html: (url: string, opts?: GotoOptions) => Promise<string>
  page: (name?: string) => Promise<Page>
  pdf: (page: Page, opts?: PDFOptions) => Promise<Buffer>
  screenshot: (page: Page, opts?: ScreenshotOptions) => Promise<Buffer>
  text: (url: string, opts?: GotoOptions) => Promise<string>
  getDevice: (deviceName: string) => Viewport | undefined
  destroyContext: (opts?: { force?: boolean }) => Promise<void>
  withPage: <T>(fn: (page: Page, goto: unknown) => Promise<T>, opts?: { timeout?: number }) => Promise<T>
}

export interface GotoOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'
  timeout?: number
  headers?: Record<string, string>
  [key: string]: unknown
}

export interface GotoResult {
  response: HTTPResponse | null
  error: Error | null
}

export interface ScreenshotOptions {
  type?: 'png' | 'jpeg' | 'webp'
  fullPage?: boolean
  clip?: {
    x: number
    y: number
    width: number
    height: number
  }
  omitBackground?: boolean
  encoding?: 'binary' | 'base64'
}

export interface Browserless {
  createContext: (opts?: ContextOptions) => Promise<Context>
  respawn: () => void
  browser: () => Promise<Browser>
  close: () => Promise<void>
  isClosed: () => boolean
  driver: unknown
}

declare function browserless(options?: BrowserlessOptions): Promise<Browserless>

export default browserless
