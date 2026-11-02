'use strict'

const { default: test } = require('ava')
const http = require('http')
const net = require('net')

const forwarder = require('../src/proxy-forwarder')

const { forwardProxy, closeForwarder } = forwarder

const opened = []
forwarder.forwardProxy = async contextOpts => {
  const forwarded = await forwardProxy(contextOpts)
  opened.push(forwarded.proxyServer)
  return forwarded
}

const { getBrowser } = require('@browserless/test')

const LOOPBACK_FORWARDER = /^http:\/\/127\.0\.0\.1:\d+$/

const isListening = url =>
  new Promise(resolve => {
    const socket = net.connect(Number(new URL(url).port), '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

const runProxy = async t => {
  const server = http.createServer((req, res) => res.end())
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.teardown(() => new Promise(resolve => server.close(resolve)))
  return server.address().port
}

for (const proxyServer of [
  undefined,
  '127.0.0.1:8080',
  'proxy.example:8080',
  'http://proxy.example:8080',
  'socks5://proxy.example:1080'
]) {
  test(`${proxyServer} is used as it is`, async t => {
    const contextOpts = { proxyServer, proxyBypassList: ['<-loopback>'] }
    t.deepEqual(await forwardProxy(contextOpts), contextOpts)
  })
}

for (const credentials of ['user:secret', 'user', ':secret', 'us%40er:p%40ss%3Aw%2Frd']) {
  test(`a proxy with ${credentials} credentials is forwarded from loopback`, async t => {
    const forwardedPromise = forwardProxy({
      proxyServer: `http://${credentials}@proxy.example:8080`,
      proxyBypassList: ['<-loopback>']
    })
    const forwarded = await forwardedPromise
    const listeningWhileOpen = await isListening(forwarded.proxyServer)
    await closeForwarder(forwardedPromise)

    t.regex(forwarded.proxyServer, LOOPBACK_FORWARDER)
    t.deepEqual(forwarded.proxyBypassList, ['<-loopback>'])
    t.true(listeningWhileOpen)
    t.false(await isListening(forwarded.proxyServer))
  })
}

test('closing a forwarder that never started does nothing', async t => {
  await t.notThrowsAsync(closeForwarder(Promise.reject(new Error('never started'))))
  await t.notThrowsAsync(closeForwarder(Promise.resolve({})))
  await t.notThrowsAsync(closeForwarder(Promise.resolve({ proxyServer: '127.0.0.1:8080' })))
})

test.serial('the forwarder listens only while its context is open', async t => {
  const port = await runProxy(t)
  opened.length = 0

  const browserless = await getBrowser().createContext({
    proxyServer: `http://user:secret@127.0.0.1:${port}`
  })
  await browserless.context()
  const [proxyServer] = opened
  const listeningWhileOpen = await isListening(proxyServer)
  await browserless.destroyContext()

  t.regex(proxyServer, LOOPBACK_FORWARDER)
  t.true(listeningWhileOpen)
  t.false(await isListening(proxyServer))
})

test.serial('a context that fails to open still closes its forwarder', async t => {
  const port = await runProxy(t)
  opened.length = 0

  const browserless = await getBrowser().createContext({
    proxyServer: `http://user:secret@127.0.0.1:${port}`,
    proxyBypassList: 'not a list'
  })
  await t.throwsAsync(browserless.context())
  await t.throwsAsync(browserless.destroyContext())

  t.false(await isListening(opened[0]))
})
