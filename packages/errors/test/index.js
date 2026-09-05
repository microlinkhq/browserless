'use strict'

const test = require('ava')
const errors = require('..')

test('avoid parse ensureError twice', t => {
  const error = errors.ensureError({
    message: 'Protocol error (Runtime.callFunctionOn): Target closed.'
  })
  t.true(error.__parsed)
})

test('protocolError', t => {
  const parsedError = errors.ensureError({
    message: 'Protocol error (Page.printToPDF): Printing failed'
  })

  t.true(parsedError instanceof Error)
  t.is(parsedError.name, 'BrowserlessError')
  t.is(parsedError.code, 'EPROTOCOL')
  t.is(parsedError.message, 'EPROTOCOL, Printing failed')

  const error = errors.protocolError({ message: 'Printing failed' })
  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EPROTOCOL')
  t.is(error.message, 'EPROTOCOL, Printing failed')
})

test('browserTimeout', t => {
  const error = errors.browserTimeout({ timeout: 50 })

  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EBRWSRTIMEOUT')
  t.is(error.message, 'EBRWSRTIMEOUT, Promise timed out after 50 milliseconds')
})

test('evaluationFailed', t => {
  {
    const parsedError = errors.ensureError({
      message: "Evaluation failed: TypeError: Cannot read property 'bar' of undefined"
    })

    t.true(parsedError instanceof Error)
    t.is(parsedError.name, 'BrowserlessError')
    t.is(parsedError.code, 'EINVALEVAL')
    t.is(parsedError.message, "EINVALEVAL, Cannot read property 'bar' of undefined")

    const error = errors.evaluationFailed("Cannot read property 'bar' of undefined")

    t.true(error instanceof Error)
    t.is(error.name, 'BrowserlessError')
    t.is(error.code, 'EINVALEVAL')
    t.is(error.message, "EINVALEVAL, Cannot read property 'bar' of undefined")
  }
  {
    const parsedError = errors.ensureError({
      message: "Cannot read properties of undefined (reading 'versoin')"
    })

    t.true(parsedError instanceof Error)
    t.is(parsedError.name, 'BrowserlessError')
    t.is(parsedError.code, 'EINVALEVAL')

    t.is(parsedError.message, "EINVALEVAL, Cannot read properties of undefined (reading 'versoin')")

    const error = errors.evaluationFailed("Cannot read properties of undefined (reading 'versoin')")

    t.true(error instanceof Error)
    t.is(error.name, 'BrowserlessError')
    t.is(error.code, 'EINVALEVAL')
    t.is(error.message, "EINVALEVAL, Cannot read properties of undefined (reading 'versoin')")
  }
  {
    const parsedError = errors.ensureError({
      message: 'version is not defined'
    })

    t.true(parsedError instanceof Error)
    t.is(parsedError.name, 'BrowserlessError')
    t.is(parsedError.code, 'EINVALEVAL')

    t.is(parsedError.message, 'EINVALEVAL, version is not defined')

    const error = errors.evaluationFailed('version is not defined')

    t.true(error instanceof Error)
    t.is(error.name, 'BrowserlessError')
    t.is(error.code, 'EINVALEVAL')
    t.is(error.message, 'EINVALEVAL, version is not defined')
  }
})

test('contextDisconnected from Runtime.evaluate Target closed', t => {
  const error = errors.ensureError({
    message: 'Protocol error (Runtime.evaluate): Protocol error (Runtime.evaluate): Target closed'
  })

  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EBRWSRCONTEXTCONNRESET')
})

test('contextDisconnected from Runtime.callFunctionOn Target closed', t => {
  const error = errors.ensureError({
    message: 'Protocol error (Runtime.callFunctionOn): Target closed.'
  })

  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EBRWSRCONTEXTCONNRESET')
})

test('contextDisconnected from "Session closed"', t => {
  const error = errors.ensureError({
    message: 'Session closed. Most likely the page has been closed.'
  })

  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EBRWSRCONTEXTCONNRESET')
})

test('contextDisconnected from "Attempted to use detached Frame"', t => {
  const error = errors.ensureError({
    message: "Attempted to use detached Frame 'BF1FB34FC20107D5D21C354065F61277'."
  })

  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EBRWSRCONTEXTCONNRESET')
})

test('contextDisconnected from "Execution context was destroyed"', t => {
  const error = errors.ensureError({
    message: 'Execution context was destroyed, most likely because of a navigation.'
  })

  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EBRWSRCONTEXTCONNRESET')
})

test('isContextDestroyed', t => {
  t.true(
    errors.isContextDestroyed({
      message: 'Execution context was destroyed, most likely because of a navigation.'
    })
  )
  t.true(
    errors.isContextDestroyed({ message: 'Session closed. Most likely the page has been closed.' })
  )
  t.true(errors.isContextDestroyed({ message: "Attempted to use detached Frame 'BF1'." }))
  t.true(
    errors.isContextDestroyed({
      message: 'Protocol error (Target.createTarget): Target closed'
    })
  )
  t.true(
    errors.isContextDestroyed({
      message: 'Protocol error (Runtime.evaluate): Protocol error (Runtime.evaluate): Target closed'
    })
  )
  t.true(
    errors.isContextDestroyed({
      message: 'Protocol error (Runtime.callFunctionOn): Target closed.'
    })
  )
  t.true(
    errors.isContextDestroyed(
      'Execution context was destroyed, most likely because of a navigation.'
    )
  )
  t.true(errors.isContextDestroyed({ error: { message: 'Execution context was destroyed' } }))
  // Chrome's other phrasing of a detached frame, carrying the frame URL — seen
  // in production on SPAs (app.oviond.com) that navigate to a sub-route mid-print.
  t.true(
    errors.isContextDestroyed({
      message:
        'Execution context is not available in detached frame or worker "https://app.oviond.com/pdf/x"'
    })
  )
  // The inverse race: an operation ran before the main frame attached.
  t.true(errors.isContextDestroyed({ message: 'Requesting main frame too early!' }))

  t.false(errors.isContextDestroyed({ message: 'Evaluation failed: boom' }))
  t.false(errors.isContextDestroyed({ message: 'Navigation timeout of 30000 ms exceeded' }))
  t.false(errors.isContextDestroyed('boom'))
  t.false(errors.isContextDestroyed(null))
})

test('pageRange', t => {
  const parsedError = errors.ensureError({
    message: 'Protocol error (Page.printToPDF): Page range exceeds page count'
  })

  t.true(parsedError instanceof Error)
  t.is(parsedError.name, 'BrowserlessError')
  t.is(parsedError.code, 'EPAGERANGE')
  t.is(parsedError.message, 'EPAGERANGE, Page range exceeds page count')

  const error = errors.pageRange()
  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EPAGERANGE')
  t.is(error.message, 'EPAGERANGE, Page range exceeds page count')
})

test('isPageRangeOvershoot', t => {
  t.true(
    errors.isPageRangeOvershoot({
      message: 'Protocol error (Page.printToPDF): Page range exceeds page count'
    })
  )
  t.true(errors.isPageRangeOvershoot('Page range exceeds page count'))
  t.true(errors.isPageRangeOvershoot({ error: { message: 'Page range exceeds page count' } }))
  t.true(
    errors.isPageRangeOvershoot(errors.protocolError({ message: 'Page range exceeds page count' }))
  )

  t.false(
    errors.isPageRangeOvershoot({ message: 'Protocol error (Page.printToPDF): Printing failed' })
  )
  t.false(errors.isPageRangeOvershoot({ message: 'Page is too large.' }))
  t.false(errors.isPageRangeOvershoot(null))
  t.false(errors.isPageRangeOvershoot({}))
})

// The core retries `EBRWSRCONTEXTCONNRESET` and `EPROTOCOL` and nothing else.
test('an overshoot is not classified as a retryable protocol error', t => {
  const overshoot = errors.ensureError({
    message: 'Protocol error (Page.printToPDF): Page range exceeds page count'
  })
  const printing = errors.ensureError({
    message: 'Protocol error (Page.printToPDF): Printing failed'
  })

  t.is(overshoot.code, 'EPAGERANGE')
  t.is(printing.code, 'EPROTOCOL')
})

test('ensureError handles non-object input', t => {
  const errorFromString = errors.ensureError('boom')
  t.true(errorFromString instanceof Error)
  t.true(errorFromString.message.includes('boom'))

  const errorFromNull = errors.ensureError(null)
  t.true(errorFromNull instanceof Error)
  t.is(errorFromNull.message, 'null')

  const errorFromNestedString = errors.ensureError({ error: 'nested boom' })
  t.true(errorFromNestedString instanceof Error)
  t.true(errorFromNestedString.message.includes('nested boom'))
})
