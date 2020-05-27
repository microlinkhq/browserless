'use strict'

const lighthouse = require('lighthouse')

const runLighthouse = async ({ url, opts, config }) => {
  const { lhr, report } = await lighthouse(url, opts, config)
  return opts.output === 'json' ? lhr : report
}

process.on('message', async opts => process.send(await runLighthouse(opts)))
