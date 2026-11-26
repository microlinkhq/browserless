'use strict'

const Module = require('module')
const fs = require('fs')

const realRequire = Module.prototype.require
const resources = JSON.stringify({
  redirects: [
    { name: 'noop.js', aliases: [], body: 'void 0', contentType: 'application/javascript' }
  ],
  scriptlets: []
})

const reply = body => {
  const promise = Promise.resolve(body)
  promise.text = () => promise
  promise.buffer = () => Promise.resolve(Buffer.from(body))
  promise.json = () => Promise.resolve({})
  return promise
}

Module.prototype.require = function (id) {
  if (id === '@kikobeats/got') {
    return (url, options = {}) => {
      if (options.timeout !== 60000) throw new Error('download is missing its timeout')
      if (url === 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt') {
        return reply('||tracker.example^\n')
      }
      if (url.endsWith('/ublock-origin/resources.json')) return reply(resources)
      return reply('||ads.example^$script')
    }
  }
  if (id === 'fs') {
    const real = realRequire.apply(this, arguments)
    return new Proxy(real, {
      get (target, property, receiver) {
        if (property !== 'writeFile') {
          const value = Reflect.get(target, property, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        }
        return (file, data, options, done) => {
          const callback = typeof options === 'function' ? options : done
          if (String(file).endsWith('engine.bin')) {
            fs.writeFileSync(process.env.ENGINE_OUT, data)
            callback(null)
            return
          }
          return target.writeFile(file, data, options, callback)
        }
      }
    })
  }
  return realRequire.apply(this, arguments)
}
