'use strict'

const { Readable } = require('stream')
const $ = require('tinyspawn')

module.exports = (buffer, { width, height, frameRate = 30 }) =>
  new Promise(resolve => {
    const subprocess = $('ffmpeg', [
      '-loglevel',
      'error',
      // Reduces general buffering.
      // '-avioflags',
      // 'direct',
      // Reduces initial buffering while analyzing input fps and other stats.
      '-fpsprobesize',
      '0',
      '-probesize',
      '32',
      '-analyzeduration',
      '0',
      // '-fflags',
      // 'nobuffer',
      // Forces input to be read from standard input, and forces png input
      // image format.
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      '-i',
      'pipe:0',
      // Overwrite output and no audio.
      '-y',
      '-an',
      // This drastically reduces stalling when cpu is overbooked. By default
      // VP9 tries to use all available threads?
      '-threads',
      '1',
      // Specifies the frame rate we are giving ffmpeg.
      '-framerate',
      `${frameRate}`,
      // Specifies the encoding and format we are using.
      '-vf',
      'fps=5,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse',
      '-f',
      'gif',
      // Disable bitrate.
      '-b:v',
      '0',
      // Filters to ensure the images are piped correctly.
      '-vf',
      `scale=${width}:${height}`,
      'pipe:1'
    ])

    const chunks = []
    subprocess.stdout.on('data', data => chunks.push(data))
    subprocess.stdout.on('end', () => resolve(Buffer.concat(chunks)))
    Readable.from(buffer).pipe(subprocess.stdin)
  })
