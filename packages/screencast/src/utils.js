/* global createImageBitmap, Blob, MediaRecorder, FileReader */

'use strict'

const getCDPClient = page => page._client()

const startScreencast = async (page, { onFrame, ...opts }) => {
  const client = getCDPClient(page)
  const acks = []

  client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    onFrame(data, metadata)
    acks.push(client.send('Page.screencastFrameAck', { sessionId }).catch(() => {}))
  })

  const windowSize = await page.evaluate(() => ({
    maxWidth: window.innerWidth,
    maxHeight: window.innerHeight
  }))

  // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast
  await client.send('Page.startScreencast', { ...opts, ...windowSize })
  return () => Promise.all(acks).then(() => client.send('Page.stopScreencast'))
}

const createScreenRecorder = async (page, { format }) => {
  const screenRecorder = await page.evaluateHandle(format => {
    class ScreenRecorder {
      constructor ({ format }) {
        this.videoMimeType = format.startsWith('video') ? format : `video/${format}`
        if (!MediaRecorder.isTypeSupported(this.videoMimeType)) {
          throw new TypeError(
            `The MediaRecorder type provided (${this.videoMimeType}) is not supported`
          )
        }

        this.canvas = document.createElement('canvas')
        document.body.appendChild(this.canvas)
        this.ctx = this.canvas.getContext('2d')
        this.chunks = []
      }

      async beginRecording (stream) {
        return new Promise((resolve, reject) => {
          this.recorder = new MediaRecorder(stream, {
            mimeType: this.videoMimeType
          })
          this.recorder.ondataavailable = ({ data }) => this.chunks.push(data)
          this.recorder.onerror = reject
          this.recorder.onstop = resolve
          this.recorder.start()
        })
      }

      async serialize () {
        await this.recordingFinish
        return new Promise((resolve, reject) => {
          const blob = new Blob(this.chunks, { type: this.videoMimeType })
          const reader = new FileReader()
          reader.onload = event => resolve(event.target.result)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
      }

      start () {
        this.canvas.width = window.innerWidth
        this.canvas.height = window.innerHeight
        this.recordingFinish = this.beginRecording(this.canvas.captureStream())
      }

      async draw (base64, mimeType) {
        const data = await fetch(`data:${mimeType};base64,${base64}`)
          .then(res => res.blob())
          .then(blob => createImageBitmap(blob))
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        this.ctx.drawImage(data, 0, 0)
      }

      stop () {
        this.recorder.stop()
        return this.serialize()
      }
    }

    return new ScreenRecorder({ format })
  }, format)

  return {
    start: () => page.evaluate(sr => sr.start(), screenRecorder),
    draw: data => page.evaluate((sr, data) => sr.draw(data), screenRecorder, data),
    stop: () => page.evaluate(sr => sr.stop(), screenRecorder)
  }
}

module.exports = { getCDPClient, createScreenRecorder, startScreencast }
