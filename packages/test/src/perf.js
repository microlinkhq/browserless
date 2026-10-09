'use strict'

const { execFileSync } = require('node:child_process')
const vm = require('node:vm')

// Same page, interleaved, so a slow runner slows the base and the pull request together.
// The 10% band is timer noise, matching the agent snapshot gate.
const slowerThanBase = (head, base) => head > base * 1.1 && head > base + 1

const baseSource = repoPath => {
  const rev = process.env.PERF_BASE || 'origin/master'
  try {
    return execFileSync('git', ['show', `${rev}:${repoPath}`], { encoding: 'utf8' })
  } catch (error) {
    if (process.env.PERF_BASE) throw error
    return null
  }
}

const between = (source, start, end) => {
  const from = source.indexOf(start)
  if (from < 0) return null
  const to = end ? source.indexOf(end, from + start.length) : source.length
  if (to < 0) return null
  return source.slice(from, to).trim()
}

const expression = source => {
  const trimmed = source.trim().replace(/;\s*$/, '')
  if (trimmed.startsWith('function ') || trimmed.startsWith('async function ')) return trimmed
  const assigned = trimmed.match(/^(?:const|let|var) \w+ = ([\s\S]+)$/)
  if (!assigned) throw new Error('Performance source is not a function expression.')
  return assigned[1].replace(/;\s*$/, '')
}

const p50 = values => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.5) - 1]

const timePair = (head, base) => {
  const samples = { head: [], base: [] }
  for (let i = 0; i < 18; i++) {
    const order = i % 2 ? ['head', 'base'] : ['base', 'head']
    for (const which of order) {
      const started = performance.now()
      ;(which === 'head' ? head : base)()
      if (i >= 3) samples[which].push(performance.now() - started)
    }
  }
  return { head: p50(samples.head), base: p50(samples.base) }
}

const timeInPage = (page, headSource, baseSource) =>
  page.evaluate(
    (head, base) => {
      const install = (key, source) => {
        const script = document.createElement('script')
        script.textContent = `globalThis.${key} = ${source}`
        document.documentElement.append(script)
        script.remove()
      }
      install('__perfHead', head)
      install('__perfBase', base)
      const samples = { head: [], base: [] }
      for (let i = 0; i < 18; i++) {
        const order = i % 2 ? ['head', 'base'] : ['base', 'head']
        for (const which of order) {
          const started = performance.now()
          const fn = which === 'head' ? globalThis.__perfHead : globalThis.__perfBase
          fn()
          if (i >= 3) samples[which].push(performance.now() - started)
        }
      }
      const mid = values => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.5) - 1]
      return { head: mid(samples.head), base: mid(samples.base) }
    },
    headSource,
    baseSource
  )

const loadModule = (source, resolve = require) => {
  const module = { exports: {} }
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      require: resolve,
      Buffer,
      console,
      Math
    },
    { filename: 'perf-base.js' }
  )
  return module.exports
}

const denseHtml = () => {
  const rows = Array.from(
    { length: 2000 },
    (_, index) => `<div class="row"><span>Item ${index}</span><p>${'text '.repeat(6)}</p></div>`
  ).join('')
  return `<!doctype html><style>#scroller{overflow:auto;height:120px}</style><div id="scroller">${rows}</div>`
}

const gate = (t, rows) => {
  if (!rows.length) return t.pass()
  t.log(
    rows
      .map(row => `${row.name} ${row.head.toFixed(1)} ms vs base ${row.base.toFixed(1)} ms`)
      .join(', ')
  )
  const slower = rows.filter(row => slowerThanBase(row.head, row.base))
  t.deepEqual(
    slower.map(row => `${row.name} ${row.head.toFixed(1)} > ${row.base.toFixed(1)}`),
    []
  )
}

module.exports = {
  baseSource,
  between,
  expression,
  timePair,
  timeInPage,
  loadModule,
  denseHtml,
  gate
}
