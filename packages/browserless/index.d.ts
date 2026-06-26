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
  goto: (page: Page, opts: GotoOptions & { url: string }) => Promise<GotoResult>
  html: (url: string, opts?: GotoOptions) => Promise<string>
  page: (name?: string) => Promise<Page>
  pdf: (page: Page, opts?: PDFOptions) => Promise<Buffer>
  screenshot: (page: Page, opts?: ScreenshotOptions) => Promise<Buffer>
  text: (url: string, opts?: GotoOptions) => Promise<string>
  getDevice: (deviceName: string) => Viewport | undefined
  report: (opts?: { benchmark?: boolean }) => Promise<HardwareInfo>
  destroyContext: (opts?: { force?: boolean }) => Promise<void>
  withPage: <T>(fn: (page: Page, goto: unknown) => Promise<T>, opts?: { timeout?: number }) => Promise<T>
}

export interface GotoOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'
  timeout?: number
  headers?: Record<string, string>
  flattenShadowDOM?: boolean
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

export interface WebGLContextInfo {
  supported: boolean
  /** From WEBGL_debug_renderer_info; null if the extension is unavailable. */
  unmaskedVendor?: string | null
  unmaskedRenderer?: string | null
  version?: string
  shadingLanguageVersion?: string
  /** GL MAX_* parameters (e.g. maxTextureSize). maxViewportDims is a [w, h] pair. */
  capabilities?: Record<string, number | number[]>
  extensions?: string[]
}

export interface WebGPUInfo {
  supported: boolean
  adapter?: {
    vendor: string | null
    architecture: string | null
    device: string | null
    description: string | null
  }
}

export interface HardwareInfo {
  browser: {
    name: string
    version: string | null
    headless: boolean
    /** Release channel ("stable" | "beta" | "dev" | "canary"), when detectable. */
    channel?: string
    /** Build flavor, e.g. "Chromium" | "chrome-for-testing" | "chrome-headless-shell". */
    build?: string
    /** Full sanitized command line; env-specific/sensitive args are omitted. */
    arguments?: string[]
    /** Only the flags this app intentionally adds (excludes Chromium/Puppeteer defaults). */
    customArguments?: string[]
  } | null
  environment: {
    virtualized: boolean
    container: boolean
  }
  os: {
    platform: string
    release: string
    distro?: string
  }
  cpu: {
    model?: string
    /** Physical cores. */
    cores: number
    /** Logical processors. */
    threads: number
    /** MHz; omitted when the platform does not report it. */
    speed?: number
    arch: string
    flags?: string[]
  }
  memory: {
    /** Total physical memory, in bytes. */
    total: number
  }
  gpu: {
    vendor: string | null
    device: string | null
    type: 'hardware' | 'software' | null
    /** The graphics stack ANGLE translates to. */
    graphics: {
      /** Translation layer, e.g. "ANGLE"; null when the renderer is not wrapped. */
      translationLayer: string | null
      /** Graphics API: "OpenGL" | "Vulkan" | "Metal" | "Direct3D11" | "Direct3D12" | ... */
      name: string | null
      version: string | null
    }
    /** Mesa version (software path); read from the host package. */
    mesa?: string
    /** LLVM version backing llvmpipe (software path). */
    llvm?: string
    /** llvmpipe SIMD JIT width in bits (software path). */
    simdWidth?: number
    webgl: {
      v1: WebGLContextInfo
      v2: WebGLContextInfo
    }
    webgpu: WebGPUInfo
  }
  /** Present only when report({ benchmark: true }) is requested. */
  performance?: {
    webgl: {
      frames: number
      /** Total wall time for all frames, in milliseconds. */
      totalMs: number
      /** Mean per-frame time, in milliseconds. */
      frameTimeMs: number
      fps: number
    }
  }
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
