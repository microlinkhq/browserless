'use strict'

const { anonymizeProxy, closeAnonymizedProxy } = require('proxy-chain')

const REDACTED = '***'
const DEFAULT_SCHEME = 'http://'

const forwardedProxyServers = new Set()

const parseProxyServer = proxyServer =>
  URL.parse(proxyServer.includes('://') ? proxyServer : `${DEFAULT_SCHEME}${proxyServer}`)

const hasCredentials = proxyUrl => Boolean(proxyUrl?.username || proxyUrl?.password)

const redactSecrets = (text, secrets) =>
  secrets.reduce((redacted, secret) => redacted.replaceAll(secret, REDACTED), text)

const withoutCredentials = (error, proxyUrl) => {
  const redactedUrl = new URL(proxyUrl)
  if (proxyUrl.username) redactedUrl.username = REDACTED
  if (proxyUrl.password) redactedUrl.password = REDACTED
  const secrets = [proxyUrl.username, proxyUrl.password].filter(Boolean)
  error.message = error.message
    .split(proxyUrl.href)
    .map(part => redactSecrets(part, secrets))
    .join(redactedUrl.href)
  return error
}

const forwardProxy = async contextOpts => {
  const proxyUrl = contextOpts.proxyServer && parseProxyServer(contextOpts.proxyServer)
  if (!hasCredentials(proxyUrl)) return contextOpts
  try {
    const proxyServer = await anonymizeProxy(proxyUrl.href)
    forwardedProxyServers.add(proxyServer)
    return { ...contextOpts, proxyServer }
  } catch (error) {
    throw withoutCredentials(error, proxyUrl)
  }
}

const closeForwarder = async contextOptsPromise => {
  const { proxyServer } = await contextOptsPromise.catch(() => ({}))
  if (forwardedProxyServers.delete(proxyServer)) await closeAnonymizedProxy(proxyServer, true)
}

module.exports = { forwardProxy, closeForwarder }
