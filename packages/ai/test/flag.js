'use strict'

const test = require('ava')

const createAi = require('..')

const RANK = { unavailable: 0, downloading: 1, downloadable: 2, available: 3 }

const dropFeature = (opts, name) => ({
  ...opts,
  args: opts.args.map(arg => {
    if (!arg.startsWith('--enable-features=')) return arg
    const features = arg
      .slice('--enable-features='.length)
      .split(',')
      .filter(feature => feature !== name)
    return `--enable-features=${features.join(',')}`
  })
})

const dropArg = (opts, fragment) => ({
  ...opts,
  args: opts.args.filter(arg => !arg.includes(fragment))
})

const extrasFrom = opts => {
  const { defaultArgs } = require('browserless').driver
  const extras = []
  for (const arg of opts.args) {
    if (defaultArgs.includes(arg)) continue
    if (arg.startsWith('--enable-features=')) {
      const base = defaultArgs.find(item => item.startsWith('--enable-features=')) || ''
      const stock = new Set(base.slice('--enable-features='.length).split(',').filter(Boolean))
      for (const feature of arg.slice('--enable-features='.length).split(',')) {
        if (feature && !stock.has(feature)) extras.push(feature)
      }
      continue
    }
    extras.push(arg.split('=')[0])
  }
  for (const arg of opts.ignoreDefaultArgs || []) extras.push(`ignore:${arg}`)
  return extras
}

const present = (opts, needle) => extrasFrom(opts).includes(needle)

const probe = async opts => {
  const browser = require('browserless')(opts)
  const ai = createAi(async teardown => {
    const ctx = await browser.createContext()
    teardown(() => ctx.destroyContext())
    return ctx
  })
  try {
    return await ai.capabilities({ timeout: 15000 })
  } finally {
    await browser.close()
  }
}

const cases = [
  {
    needle: 'PromptAPIForGeminiNano',
    apply: opts => dropFeature(opts, 'PromptAPIForGeminiNano'),
    apis: ['languageModel']
  },
  {
    needle: 'SummarizationAPIForGeminiNano',
    apply: opts => dropFeature(opts, 'SummarizationAPIForGeminiNano'),
    apis: ['summarizer']
  },
  {
    needle: 'OnDeviceModelForceCpuBackend',
    apply: opts => dropFeature(opts, 'OnDeviceModelForceCpuBackend'),
    apis: ['languageModel', 'summarizer']
  },
  {
    needle: 'OptimizationHints',
    apply: opts => dropFeature(opts, 'OptimizationHints'),
    apis: ['languageModel', 'summarizer', 'languageDetector']
  },
  {
    needle: '--optimization-guide-performance-class',
    apply: opts => dropArg(opts, '--optimization-guide-performance-class='),
    apis: ['languageModel', 'summarizer']
  },
  {
    needle: '--optimization-guide-on-device-model',
    apply: opts => dropArg(opts, '--optimization-guide-on-device-model='),
    apis: ['languageModel', 'summarizer', 'languageDetector']
  },
  {
    needle: '--optimization-guide-ondevice-model-execution-override',
    apply: opts => dropArg(opts, '--optimization-guide-ondevice-model-execution-override='),
    apis: ['languageModel', 'summarizer']
  },
  {
    needle: '--optimization-guide-model-override',
    apply: opts => dropArg(opts, '--optimization-guide-model-override='),
    apis: ['languageModel', 'summarizer', 'languageDetector']
  }
]

test('every launch extra has a necessity case', t => {
  const extras = extrasFrom(createAi.launch())
  const covered = new Set(cases.map(item => item.needle))
  t.true(extras.length > 0)
  for (const extra of extras) {
    t.true(covered.has(extra), `add a necessity case for ${extra}`)
  }
})

test.before(async t => {
  t.context.full = createAi.launch()
  try {
    t.context.baseline = await probe(t.context.full)
  } catch {
    t.context.baseline = {
      languageModel: 'unavailable',
      summarizer: 'unavailable',
      translator: 'unavailable',
      languageDetector: 'unavailable'
    }
  }
})

for (const { needle, apply, apis } of cases) {
  test(`${needle} is needed`, async t => {
    t.timeout(180000)
    const { full, baseline } = t.context
    if (!present(full, needle)) return t.pass(`${needle} is not in launch()`)

    const usable = apis.filter(api => (RANK[baseline[api]] || 0) > 0)
    if (!usable.length) {
      return t.pass(`${apis.join(', ')} already unavailable with all flags`)
    }

    const without = await probe(apply(full))
    const regressions = usable.filter(api => (RANK[without[api]] || 0) < RANK[baseline[api]])
    t.true(
      regressions.length > 0,
      `${needle} did not worsen ${usable.join(', ')} (${usable
        .map(api => `${api}: ${baseline[api]} → ${without[api]}`)
        .join('; ')})`
    )
  })
}
