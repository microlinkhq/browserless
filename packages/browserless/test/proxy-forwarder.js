'use strict'

const { setTimeout } = require('timers/promises')
const { default: test } = require('ava')
const { anonymizeProxy, closeAnonymizedProxy } = require('proxy-chain')
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

const closed = []
forwarder.closeForwarder = async contextOptsPromise => {
  closed.push((await contextOptsPromise.catch(() => ({}))).proxyServer)
  return closeForwarder(contextOptsPromise)
}

const { getBrowser } = require('@browserless/test')

const LOOPBACK_FORWARDER = /^http:\/\/127\.0\.0\.1:\d+$/
const CLOSE_BUDGET_MS = 1000

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
  'socks5://proxy.example:1080',
  'http=proxy.example:8080;https=proxy.example:8443'
]) {
  test(`${proxyServer} is used as it is`, async t => {
    const contextOpts = { proxyServer, proxyBypassList: ['<-loopback>'] }
    t.deepEqual(await forwardProxy(contextOpts), contextOpts)
  })
}

for (const proxyServer of [
  'http://user:secret@proxy.example:8080',
  'http://user@proxy.example:8080',
  'http://:secret@proxy.example:8080',
  'http://us%40er:p%40ss%3Aw%2Frd@proxy.example:8080',
  'user:secret@proxy.example:8080'
]) {
  test(`${proxyServer} is forwarded from loopback`, async t => {
    const forwardedPromise = forwardProxy({
      proxyServer,
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

const runTunnelingProxy = async t => {
  const tunnels = new Set()
  const server = http.createServer()
  server.on('connect', (req, socket) => {
    tunnels.add(socket)
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.teardown(() => {
    for (const socket of tunnels) socket.destroy()
    return new Promise(resolve => server.close(resolve))
  })
  return server.address().port
}

const openTunnel = proxyServer =>
  new Promise((resolve, reject) => {
    const socket = net.connect(Number(new URL(proxyServer).port), '127.0.0.1', () =>
      socket.write('CONNECT target.test:443 HTTP/1.1\r\nHost: target.test:443\r\n\r\n')
    )
    socket.once('data', chunk =>
      chunk.toString().startsWith('HTTP/1.1 200') ? resolve(socket) : reject(new Error(chunk))
    )
    socket.once('error', reject)
  })

test('closing a forwarder does not wait for an open tunnel', async t => {
  const port = await runTunnelingProxy(t)
  const forwardedPromise = forwardProxy({ proxyServer: `http://user:secret@127.0.0.1:${port}` })
  const tunnel = await openTunnel((await forwardedPromise).proxyServer)
  t.teardown(() => tunnel.destroy())

  const outcome = await Promise.race([
    closeForwarder(forwardedPromise).then(() => 'closed'),
    setTimeout(CLOSE_BUDGET_MS, 'waiting')
  ])

  t.is(outcome, 'closed')
})

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

test('a forwarder error does not carry the credentials', async t => {
  const error = await t.throwsAsync(
    forwardProxy({ proxyServer: 'ftp://proxy-key:p%40ss%3Aw%2Frd@127.0.0.1:8080' })
  )

  for (const secret of ['proxy-key', 'p%40ss%3Aw%2Frd', 'p@ss:w/rd']) {
    t.false(error.message.includes(secret), secret)
    t.false(error.stack.includes(secret), secret)
  }
})

test.serial('closing the browser closes the forwarders of contexts never destroyed', async t => {
  const port = await runProxy(t)
  opened.length = 0
  const browser = require('../src')({ timeout: 30000 })

  const contexts = await Promise.all(
    [1, 2].map(() => browser.createContext({ proxyServer: `http://user:secret@127.0.0.1:${port}` }))
  )
  await Promise.all(contexts.map(context => context.context()))
  const listeningWhileOpen = await Promise.all(opened.map(isListening))
  await browser.close()

  t.deepEqual(listeningWhileOpen, [true, true])
  t.deepEqual(await Promise.all(opened.map(isListening)), [false, false])
})

test.serial('a context created after the browser closed starts no forwarder', async t => {
  const port = await runProxy(t)
  const browser = require('../src')({ timeout: 30000 })
  await browser.close()
  opened.length = 0

  const browserless = await browser.createContext({
    proxyServer: `http://user:secret@127.0.0.1:${port}`
  })
  await t.throwsAsync(browserless.context())

  t.deepEqual(opened, [])
})

test.serial('closing the browser does not close a destroyed context again', async t => {
  const port = await runProxy(t)
  const browser = require('../src')({ timeout: 30000 })
  opened.length = 0
  closed.length = 0

  const browserless = await browser.createContext({
    proxyServer: `http://user:secret@127.0.0.1:${port}`
  })
  await browserless.context()
  await browserless.destroyContext()
  await browser.close()

  t.deepEqual(closed, opened)
})

for (const username of ['proxy-key', '127']) {
  test(`a forwarder error keeps the proxy host readable for a ${username} username`, async t => {
    const error = await t.throwsAsync(
      forwardProxy({ proxyServer: `ftp://${username}@127.0.0.1:8080` })
    )

    t.true(error.message.includes('ftp://***@127.0.0.1:8080'), error.message)
  })
}

test('closing a context does not close a forwarder it did not start', async t => {
  const proxyServer = await anonymizeProxy('http://user:secret@proxy.example:8080')
  t.teardown(() => closeAnonymizedProxy(proxyServer, true))

  await closeForwarder(Promise.resolve({ proxyServer }))

  t.true(await isListening(proxyServer))
})
