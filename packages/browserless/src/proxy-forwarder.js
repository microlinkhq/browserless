'use strict'

const { anonymizeProxy, closeAnonymizedProxy } = require('proxy-chain')

const hasCredentials = proxyServer => {
  const url = URL.parse(proxyServer ?? '')
  return Boolean(url?.username || url?.password)
}

const forwardProxy = async contextOpts =>
  hasCredentials(contextOpts.proxyServer)
    ? { ...contextOpts, proxyServer: await anonymizeProxy(contextOpts.proxyServer) }
    : contextOpts

const closeForwarder = async contextOptsPromise => {
  const { proxyServer } = await contextOptsPromise.catch(() => ({}))
  if (proxyServer) await closeAnonymizedProxy(proxyServer, true)
}

module.exports = { forwardProxy, closeForwarder }
