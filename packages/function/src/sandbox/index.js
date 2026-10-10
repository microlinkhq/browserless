'use strict'

const gateway = require('./gateway')

const SANDBOX_ERROR = 'SandboxError'

module.exports = ({ onDenied = () => {}, allowFileAccess = false } = {}) => {
  const grants = []
  const reasons = new Set()

  const recordDenial = denied => {
    reasons.add(denied.reason)
    onDenied(denied)
  }

  const grant = async page => {
    const granted = await gateway.grant(page, { onDenied: recordDenial, allowFileAccess })
    grants.push(granted)
    return granted.endpoint
  }

  const denialOf = value => {
    const message = value?.message
    if (typeof message !== 'string') return
    const reason = [...reasons].find(reason => message.includes(reason))
    return reason && { name: SANDBOX_ERROR, message: reason }
  }

  const release = () => Promise.all(grants.splice(0).map(granted => granted.revoke()))

  return { grant, denialOf, release }
}
