/* eslint-disable no-eval */

'use strict'

const { getBrowserWSEndpoint } = require('@browserless/test/util')

const path = require('path')
const test = require('ava')

const createVm = require('../src/vm')

test('passing a function', async t => {
  const vm = createVm()
  function template ({ name }) {
    return `greetings ${name}`
  }
  const fn = vm(template)

  t.deepEqual(await fn({ name: 'kiko' }), {
    isFulfilled: true,
    isRejected: false,
    value: 'greetings kiko'
  })
})

test('catch errors', async t => {
  const vm = createVm()

  async function template () {
    throw new Error('oh no')
  }

  const fn = vm(template)
  const result = await fn({ name: 'kiko' })

  t.true(result.isRejected)
  t.false(result.isFulfilled)
  t.is(result.reason.message, 'oh no')
})

test('passing an arrow function', async t => {
  const vm = createVm()
  const template = ({ name }) => `greetings ${name}`
  const fn = vm(template)

  t.deepEqual(await fn({ name: 'kiko' }), {
    isFulfilled: true,
    isRejected: false,
    value: 'greetings kiko'
  })
})

test('passing a function.toString', async t => {
  const vm = createVm()
  const template = ({ name }) => `greetings ${name}`
  const fn = vm(template.toString())

  t.deepEqual(await fn({ name: 'kiko' }), {
    isFulfilled: true,
    isRejected: false,
    value: 'greetings kiko'
  })
})

test('passing a string as function', async t => {
  const vm = createVm()
  // eslint-disable-next-line
  const fn = vm('({ name }) => `greetings ${name}`')

  t.deepEqual(await fn({ name: 'kiko' }), {
    isFulfilled: true,
    isRejected: false,
    value: 'greetings kiko'
  })
})

test('passing an async function', async t => {
  const vm = createVm()

  async function template ({ name }) {
    function delay (t, v) {
      return new Promise(function (resolve) {
        setTimeout(resolve.bind(null, v), t)
      })
    }

    await delay(50)
    return `greetings ${name}`
  }

  const fn = vm(template)

  t.deepEqual(await fn({ name: 'kiko' }), {
    isFulfilled: true,
    isRejected: false,
    value: 'greetings kiko'
  })
})

test('run browserless code', async t => {
  const browserWSEndpoint = await getBrowserWSEndpoint()

  const url = 'https://example.com'
  const scriptPath = path.resolve(__dirname, 'vm.js')

  const code = 'async (page) => page.title();'

  const template = `async ({ browserWSEndpoint, code, url, opts }) => {
    const getBrowserless = require('browserless')
    const browserless = await getBrowserless({ timeout: 60000, mode: 'connect', browserWSEndpoint }).createContext()
    const browserFn = browserless.evaluate(${eval(code)})
    const result = await browserFn(url, opts)
    return result
  }`

  const vm = createVm({
    require: {
      external: {
        modules: ['p-reflect', 'p-retry', 'metascraper', 'metascraper-', '@metascraper', 'lodash']
      }
    }
  })

  const fn = vm(template, scriptPath)

  t.deepEqual(await fn({ browserWSEndpoint, code, url }), {
    isFulfilled: true,
    isRejected: false,
    value: 'Example Domain'
  })
})
