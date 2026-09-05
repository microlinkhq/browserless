'use strict'

const { isContextDestroyed } = require('@browserless/errors')

// Tells a frame torn down mid-flight (a client-side navigation, which settles
// and retries fine) apart from a page we no longer have: once the page or its
// session is closed — the request ended and its context was destroyed — nothing
// it is waiting on can arrive, so waiting is spent on work nobody wants.
//
// `TargetCloseError` is puppeteer's own signal that the CDP session is detached
// (`CdpSession.send` raises it the moment `detached` is set). Ask it as well as
// the page: the session flips first, so between the two there is a window where
// every call throws yet `isClosed()` still answers false.
const isDeadTarget = error =>
  error?.name === 'TargetCloseError' || (error?.message || '').includes('Target closed')

const isTransientContextLoss = (page, error) =>
  isContextDestroyed(error) && !isDeadTarget(error) && !page.isClosed()

module.exports = isTransientContextLoss
