'use strict'

const gateway = require('./gateway')

const SANDBOX_ERROR = 'SandboxError'

module.exports = ({ onDenied = () => {}, allowFileAccess = false } = {}) => {
  const grants = []
  const reasons = new Set()
  let released = false

  const recordDenial = denied => {
    reasons.add(denied.reason)
    onDenied(denied)
  }

  // A timed-out run can keep retrying and reach here after `release` has run,
  // so a grant that lands once released is revoked instead of left open.
  const grant = async page => {
    const granted = await gateway.grant(page, { onDenied: recordDenial, allowFileAccess })
    if (released) {
      await granted.revoke()
      return granted.endpoint
    }
    grants.push(granted)
    return granted.endpoint
  }

  const denialOf = value => {
    const message = value?.message
    if (typeof message !== 'string') return
    const reason = [...reasons].find(reason => message.includes(reason))
    return reason && { name: SANDBOX_ERROR, message: reason }
  }

  const release = () => {
    released = true
    return Promise.all(grants.splice(0).map(granted => granted.revoke()))
  }

  return { grant, denialOf, release }
}
