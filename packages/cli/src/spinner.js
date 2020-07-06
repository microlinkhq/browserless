'use strict'

const createProcStats = require('process-stats')
const prettyBytes = require('pretty-bytes')
const { gray } = require('kleur')
const ora = require('ora')

const TICK_INTERVAL = 100
const procStats = createProcStats({ tick: TICK_INTERVAL })

const stats = () => {
  const { cpu: cpuUsage, uptime, memUsed } = procStats()
  const time = `time${gray(`=${uptime.pretty}`)}`
  const cpu = `cpu${gray(`=${cpuUsage.pretty}`)}`
  const memory = `memory${gray(`=${memUsed.pretty}`)}`

  return `${time} ${cpu} ${memory}`
}

const spinner = ora({
  color: 'white'
})
let timer

const start = () => {
  console.log()
  spinner.start()

  timer = setInterval(() => {
    spinner.text = stats()
  }, TICK_INTERVAL)
}

const stop = (str = '') => {
  spinner.stop()
  clearInterval(timer)
  const sizeValue = `=${prettyBytes(Buffer.from(JSON.stringify(str)).byteLength)}`
  const info = `${stats()} size=${gray(sizeValue)}`
  procStats.destroy()
  return info
}

module.exports = { start, stop }
