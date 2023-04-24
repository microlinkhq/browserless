'use strict'

const createProcStats = require('process-stats')
const { createSpinner } = require('nanospinner')
const prettyBytes = require('pretty-bytes')
const { gray } = require('picocolors')

const TICK_INTERVAL = 100
const procStats = createProcStats({ tick: TICK_INTERVAL })

const stats = () => {
  const { cpu: cpuUsage, uptime, memUsed } = procStats()
  const time = `time${gray(`=${uptime.pretty}`)}`
  const cpu = `cpu${gray(`=${cpuUsage.pretty}`)}`
  const memory = `memory${gray(`=${memUsed.pretty}`)}`

  return `${time} ${cpu} ${memory}`
}

const spinner = createSpinner(stats(), { color: 'white' })
let timer

const start = () => {
  console.log()
  spinner.start(stats())
  timer = setInterval(() => {
    spinner.update({ text: stats() })
  }, TICK_INTERVAL)
}

const stop = (str = '') => {
  const sizeValue = `=${prettyBytes(Buffer.from(JSON.stringify(str)).byteLength)}`
  const text = `${stats()} size=${gray(sizeValue)}\n`

  procStats.destroy()
  spinner.success({ text })
  clearInterval(timer)
}

module.exports = { start, stop }
