'use strict'

const test = require('ava')

const { prepareFullDocument } = require('../src/prepare-full-document')

test('prepareFullDocument tolerates navigation during the scroll', async t => {
  const goto = {
    timeouts: {
      action: () => 1000,
      goto: () => 1000
    }
  }

  const page = {
    evaluate: async () => {
      throw new Error('Execution context was destroyed, most likely because of a navigation.')
    }
  }

  const result = await prepareFullDocument(page, { goto, timeout: 1000 })
  t.is(result.expanded, false)
  t.is(result.scrolled, false)
  t.true(typeof result.duration === 'number')
})
