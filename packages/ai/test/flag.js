'use strict'

const test = require('ava')

const createAi = require('..')

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
  return extras
}

const cases = [
  'OnDeviceModelForceCpuBackend',
  'OptimizationHints',
  '--disable-model-download-verification',
  '--optimization-guide-ondevice-model-execution-override',
  '--optimization-guide-model-override'
]

test('every launch extra has a necessity case', t => {
  const extras = extrasFrom(createAi.launch())
  const covered = new Set(cases)
  t.true(extras.length > 0)
  for (const extra of extras) {
    t.true(covered.has(extra), `add a necessity case for ${extra}`)
  }
})
