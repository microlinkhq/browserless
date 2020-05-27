'use strict'

const lighthouse = require('lighthouse')

const runLighthouse = async ({ url, flags, config }) => {
  const { lhr, report } = await lighthouse(url, flags, config)
  return flags.output === 'json' ? lhr : report
}

process.on('message', async opts => process.send(await runLighthouse(opts)))
