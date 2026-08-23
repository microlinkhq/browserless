'use strict'

const { isContextDestroyed } = require('@browserless/errors')

// Tells a frame torn down mid-flight (a client-side navigation, which settles
// and retries fine) apart from a page we no longer have: once the page or its
// session is closed — the request ended and its context was destroyed — nothing
// it is waiting on can arrive, so waiting is spent on work nobody wants.
const isTransientContextLoss = (page, error) => isContextDestroyed(error) && !page.isClosed()

module.exports = isTransientContextLoss
