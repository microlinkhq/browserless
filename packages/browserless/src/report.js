'use strict'

const { execFile } = require('child_process')
const { readFileSync, existsSync } = require('fs')
const { promisify } = require('util')
const os = require('os')

const driver = require('./driver')

const execFileAsync = promisify(execFile)

// Inspect the hardware the browser actually renders on: the browser build, the
// GPU/WebGL/WebGPU backends (resolved at runtime, in-page), and the host
// environment / OS / CPU / memory (from Node). Optionally runs a small
// deterministic WebGL benchmark (`report({ benchmark: true })`).
//
// GPU: the ANGLE renderer string (e.g. "ANGLE (Mesa, llvmpipe (LLVM 15.0.7 256
// bits), OpenGL 4.5)") is parsed into normalized fields:
//   - vendor / device       the GL vendor and renderer device.
//   - type                  'software' (llvmpipe/swiftshader CPU path) or 'hardware';
//                           a swiftshader device is the slow (~4x) fallback we
//                           must never silently hit.
//   - graphics              { translationLayer, name, version } — ANGLE translates
//                           to a graphics API (OpenGL/Vulkan/Metal/Direct3D11/12).
//                           Structured so new APIs need no schema change.
//   - mesa / llvm / simdWidth   software-stack detail; `mesa` is NOT in the string
//                           (ANGLE drops it), so it is read from the host package.
// Per-version `webgl.v1`/`webgl.v2` keep the raw UNMASKED strings, the renderer
// `capabilities` (GL MAX_* parameters) and the supported-extension list.
//
// memory.total is in BYTES. OS distro gates the available Mesa/LLVM (e.g. Ubuntu
// 22.04 caps at Mesa 23.2.1 / LLVM 15). See ./driver.js and the HardwareInfo type
// in ../../index.d.ts.

const DEFAULT_ARGS = new Set(driver.defaultArgs || [])

const CAPABILITY_ENUMS = [
  'MAX_TEXTURE_SIZE',
  'MAX_CUBE_MAP_TEXTURE_SIZE',
  'MAX_RENDERBUFFER_SIZE',
  'MAX_VERTEX_ATTRIBS',
  'MAX_TEXTURE_IMAGE_UNITS',
  'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
  'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
  'MAX_SAMPLES',
  'MAX_VIEWPORT_DIMS'
]

const readBackend = enums => {
  const read = type => {
    let gl
    try {
      gl = document.createElement('canvas').getContext(type)
    } catch {
      gl = null
    }
    if (!gl) return { supported: false }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const capabilities = {}
    for (const name of enums) {
      const pname = gl[name] // undefined where the enum doesn't exist (e.g. MAX_SAMPLES on webgl1)
      if (pname === undefined) continue
      let value = gl.getParameter(pname)
      if (value == null) continue
      if (typeof value === 'object' && 'length' in value) value = Array.from(value)
      capabilities[name.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value
    }
    return {
      supported: true,
      unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      capabilities,
      extensions: gl.getSupportedExtensions() || []
    }
  }
  return { v1: read('webgl'), v2: read('webgl2') }
}

const readWebGPU = async () => {
  if (typeof navigator === 'undefined' || !navigator.gpu) return { supported: false }
  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return { supported: false }
    let info = null
    try {
      info =
        adapter.info ||
        (typeof adapter.requestAdapterInfo === 'function'
          ? await adapter.requestAdapterInfo()
          : null)
    } catch {
      info = null
    }
    if (!info) return { supported: true }
    return {
      supported: true,
      adapter: {
        vendor: info.vendor || null,
        architecture: info.architecture || null,
        device: info.device || null,
        description: info.description || null
      }
    }
  } catch {
    return { supported: false }
  }
}

// Small deterministic fragment-bound WebGL benchmark: render N frames of a
// fixed sin/cos shader, forcing each via readPixels (so the software pipeline
// actually rasterizes), and report the timing. Same renderer as production;
// ~300ms on llvmpipe. For comparing environments / catching render regressions.
const runBenchmark = () => {
  const SIZE = 512
  const FRAMES = 60
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const gl = canvas.getContext('webgl')
  if (!gl) return null
  const compile = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
    return s
  }
  try {
    const vs = compile(
      gl.VERTEX_SHADER,
      'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}'
    )
    const fs = compile(
      gl.FRAGMENT_SHADER,
      'precision highp float;uniform float t;void main(){vec2 u=gl_FragCoord.xy/512.0;float v=0.0;for(int i=0;i<24;i++){v+=sin(u.x*float(i)+t)*cos(u.y*float(i)-t);}gl_FragColor=vec4(fract(v),u,1.0);}'
    )
    const prog = gl.createProgram()
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    gl.useProgram(prog)
    gl.viewport(0, 0, SIZE, SIZE)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const tl = gl.getUniformLocation(prog, 't')
    const px = new Uint8Array(4)
    const frame = i => {
      gl.uniform1f(tl, i * 0.01)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) // force the frame to complete
    }
    for (let i = 0; i < 3; i++) frame(i) // warmup
    const start = performance.now()
    for (let i = 0; i < FRAMES; i++) frame(i)
    const totalMs = performance.now() - start
    const round = n => Math.round(n * 100) / 100
    return {
      webgl: {
        frames: FRAMES,
        totalMs: round(totalMs),
        frameTimeMs: round(totalMs / FRAMES),
        fps: Math.round(1000 / (totalMs / FRAMES))
      }
    }
  } catch {
    return null
  }
}

const matchOr = (re, str) => {
  const m = typeof str === 'string' ? str.match(re) : null
  return m ? m[1] : null
}

// Split on top-level commas only (ignore those nested in parentheses).
const splitTop = str => {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of str) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

// "ANGLE (Mesa, llvmpipe (LLVM 15.0.7 256 bits), OpenGL 4.5)" ->
//   { translationLayer: 'ANGLE', vendor: 'Mesa', renderer: 'llvmpipe',
//     api: 'OpenGL', apiVersion: '4.5', llvm: '15.0.7', simdWidth: 256, software: true }
const parseRenderer = renderer => {
  if (!renderer) return {}
  const wrapped = renderer.match(/^ANGLE \((.*)\)$/)
  const parts = splitTop(wrapped ? wrapped[1] : renderer)

  let vendor = null
  let rendererPart = wrapped ? wrapped[1] : renderer
  let apiPart = null
  if (wrapped && parts.length >= 3) {
    vendor = parts[0]
    rendererPart = parts.slice(1, -1).join(', ')
    apiPart = parts[parts.length - 1] // "OpenGL 4.5" / "Vulkan 1.3.0" / "SwiftShader driver-5.0.0"
  }

  const bits = matchOr(/(\d+) bits/, rendererPart)
  return {
    translationLayer: wrapped ? 'ANGLE' : null,
    vendor,
    renderer: rendererPart.replace(/\s*\(LLVM[^)]*\)/, '').trim() || null,
    api: apiPart ? apiPart.split(/\s+/)[0] : null, // OpenGL / Vulkan / Metal / Direct3D11 / SwiftShader
    apiVersion: matchOr(/(\d+(?:\.\d+)+)/, apiPart),
    llvm: matchOr(/LLVM ([\d.]+)/, rendererPart),
    simdWidth: bits ? Number(bits) : null,
    software: /\b(llvmpipe|swiftshader|softpipe)\b/i.test(renderer)
  }
}

// ANGLE hides the underlying Mesa version, so read it from the installed driver
// package. Best-effort: null off Debian/Ubuntu (e.g. macOS dev) or if dpkg fails.
const readMesaVersion = async () => {
  try {
    // Default output is `<name>\t<version>`; take the version field.
    const { stdout } = await execFileAsync('dpkg-query', ['-W', 'libgl1-mesa-dri'], {
      timeout: 1000
    })
    const version = stdout.trim().split(/\s+/).pop()
    return matchOr(/(\d+\.\d+(?:\.\d+)?)/, version) || version || null
  } catch {
    return null
  }
}

const readGpu = async page => {
  const contexts = await page.evaluate(readBackend, CAPABILITY_ENUMS) // { v1, v2 }
  const webgpu = await page.evaluate(readWebGPU)
  const parsed = parseRenderer(contexts.v1.unmaskedRenderer || contexts.v2.unmaskedRenderer || null)
  const mesa = parsed.vendor === 'Mesa' ? await readMesaVersion() : null
  return {
    vendor: parsed.vendor ?? null,
    device: parsed.renderer ?? null, // "renderer" means different things per driver
    type: parsed.renderer ? (parsed.software ? 'software' : 'hardware') : null,
    graphics: {
      translationLayer: parsed.translationLayer ?? null, // ANGLE (not a graphics driver)
      name: parsed.api ?? null, // OpenGL / Vulkan / Metal / Direct3D11 / Direct3D12
      version: parsed.apiVersion ?? null
    },
    ...(mesa ? { mesa } : {}),
    ...(parsed.llvm ? { llvm: parsed.llvm } : {}),
    ...(parsed.simdWidth ? { simdWidth: parsed.simdWidth } : {}),
    webgl: contexts,
    webgpu
  }
}

// The full launch command line, via CDP; null if unavailable.
const readCommandLine = async browser => {
  try {
    const cdp = await browser.target().createCDPSession()
    try {
      const { arguments: argv = [] } = await cdp.send('Browser.getBrowserCommandLine')
      return argv
    } finally {
      await cdp.detach().catch(() => {})
    }
  } catch {
    return null
  }
}

// Drop the executable path, positional URL and env-specific / sensitive flags
// (data dirs, extension paths, debug ports, logging), keeping the rendering-
// relevant switches useful for debugging regressions.
const OMIT_ARG =
  /^--(user-data-dir|data-path|disk-cache-dir|load-extension|disable-extensions-except|allowlisted-extension-id|remote-debugging-port|remote-debugging-pipe|crash-dumps-dir|log-file|enable-logging|flag-switches-begin|flag-switches-end|field-trial-handle|variations-)/

const sanitizeArgs = argv => argv.filter(arg => arg.startsWith('--') && !OMIT_ARG.test(arg))

const detectBuild = execPath => {
  if (/chrome-headless-shell/i.test(execPath)) return 'chrome-headless-shell'
  if (/chromium/i.test(execPath)) return 'Chromium'
  // Chrome for Testing extracts under platform-arch dirs (chrome-linux64,
  // chrome-mac-arm64, chrome-win64, ...). Match those specifically so branded
  // Chrome paths (/opt/google/chrome/chrome, ...\Application\chrome.exe) are
  // NOT misreported as a testing build.
  if (/chrome-for-testing|chrome-(linux64|win64|win32|mac-(x64|arm64))/i.test(execPath)) {
    return 'chrome-for-testing'
  }
  return null
}

const readBrowser = async page => {
  try {
    const browser = page.browser()
    const raw = await browser.version() // e.g. "Chrome/139.0.7258.154"
    const m = raw.match(/^(.*?)\/([\d.]+)/)
    const product = m ? m[1] : raw
    // "new" headless reports product "Chrome/x" (not "HeadlessChrome/x"), so
    // detect headless from the launch command line, falling back to the string.
    const argv = await readCommandLine(browser)
    const headless = argv ? argv.some(arg => /^--headless/.test(arg)) : /headless/i.test(product)
    const execPath = (typeof browser.process === 'function' && browser.process()?.spawnfile) || ''
    const channel = matchOr(/\b(stable|beta|dev|canary|unstable)\b/i, execPath)
    const build = detectBuild(execPath)
    const args = argv ? sanitizeArgs(argv) : null
    return {
      name: product.replace(/headless/i, '').trim() || product,
      version: m ? m[2] : null,
      headless,
      ...(channel ? { channel: channel.toLowerCase() } : {}),
      ...(build ? { build } : {}),
      // arguments: full sanitized command line; customArguments: only the flags
      // this app intentionally adds (driver.defaultArgs), excluding Chromium/
      // Puppeteer defaults — the ones to check when debugging config changes.
      ...(args
        ? { arguments: args, customArguments: args.filter(arg => DEFAULT_ARGS.has(arg)) }
        : {})
    }
  } catch {
    return null
  }
}

// Distro pretty name (e.g. "Ubuntu 22.04.4 LTS"); null off Linux or if absent.
const readDistro = () => {
  try {
    const line = readFileSync('/etc/os-release', 'utf8')
      .split('\n')
      .find(l => l.startsWith('PRETTY_NAME='))
    return line ? line.split('=')[1].replace(/^"|"$/g, '') || null : null
  } catch {
    return null
  }
}

const readOsInfo = () => {
  const distro = readDistro()
  return {
    platform: process.platform,
    release: os.release(),
    ...(distro ? { distro } : {})
  }
}

const readCgroup = () => {
  try {
    return readFileSync('/proc/1/cgroup', 'utf8')
  } catch {
    return ''
  }
}

const readEnvironment = flags => ({
  // x86 sets the `hypervisor` CPUID flag under any VM/KVM guest.
  virtualized: !!flags?.includes('hypervisor'),
  container:
    !!process.env.KUBERNETES_SERVICE_HOST ||
    existsSync('/.dockerenv') ||
    existsSync('/run/.containerenv') ||
    /docker|kubepods|containerd|lxc|crio/i.test(readCgroup())
})

// All CPU feature flags (e.g. sse4_2, avx, avx2). Best-effort from /proc/cpuinfo
// (Linux only); undefined elsewhere.
const readFlags = () => {
  try {
    const line = readFileSync('/proc/cpuinfo', 'utf8')
      .split('\n')
      .find(l => /^(flags|Features)\b/.test(l))
    if (!line) return undefined
    const flags = line.split(':')[1].trim().split(/\s+/)
    return flags.length ? flags : undefined
  } catch {
    return undefined
  }
}

// Physical core count from /proc/cpuinfo: unique (physical id, core id) pairs.
// undefined off Linux or when topology is hidden (then we fall back to threads).
const readCoreCount = () => {
  try {
    const ids = new Set()
    let phys = '0'
    for (const line of readFileSync('/proc/cpuinfo', 'utf8').split('\n')) {
      if (line.startsWith('physical id')) phys = line.split(':')[1].trim()
      else if (line.startsWith('core id')) ids.add(`${phys}:${line.split(':')[1].trim()}`)
    }
    return ids.size || undefined
  } catch {
    return undefined
  }
}

// os.cpus() reports speed 0 in many containers/VMs; fall back to /proc/cpuinfo.
const readMhz = () => {
  try {
    const line = readFileSync('/proc/cpuinfo', 'utf8')
      .split('\n')
      .find(l => l.startsWith('cpu MHz'))
    const mhz = line ? Math.round(parseFloat(line.split(':')[1])) : NaN
    return Number.isFinite(mhz) && mhz > 0 ? mhz : undefined
  } catch {
    return undefined
  }
}

const readCpu = flags => {
  const cpus = os.cpus() || []
  const threads = cpus.length
  const speed = cpus[0]?.speed || readMhz() // omit when unknown rather than report 0
  return {
    model: cpus[0]?.model,
    cores: readCoreCount() ?? threads,
    threads,
    ...(speed ? { speed } : {}),
    arch: process.arch,
    ...(flags ? { flags } : {})
  }
}

const report =
  page =>
    async ({ benchmark = false } = {}) => {
      const flags = readFlags()
      const [browser, gpu] = await Promise.all([readBrowser(page), readGpu(page)])
      const result = {
        browser,
        environment: readEnvironment(flags),
        os: readOsInfo(),
        cpu: readCpu(flags),
        memory: { total: os.totalmem() }, // bytes
        gpu
      }
      if (benchmark) {
        const performance = await page.evaluate(runBenchmark)
        if (performance) result.performance = performance
      }
      return result
    }

module.exports = report
module.exports.parseRenderer = parseRenderer
module.exports.detectBuild = detectBuild
