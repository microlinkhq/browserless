'use strict'

// Minimal EBML/Matroska writer used to wrap individual MJPEG frames with explicit
// timestamps before piping them into ffmpeg (`-f matroska -i pipe:0`). This lets ffmpeg
// derive frame timing from the stream instead of us repeating frames to fake a constant
// frame rate. Only the subset of Matroska needed for a single live MJPEG track is emitted.
//
// Ported from Playwright's ebml.ts (Apache-2.0, (c) Microsoft Corporation).
//
// References:
//   https://www.matroska.org/technical/elements.html
//   https://datatracker.ietf.org/doc/html/rfc8794 (EBML)

// Element IDs are written verbatim - the leading byte already encodes the length descriptor.
const kEBML = Buffer.from('1A45DFA3', 'hex')
const kEBMLVersion = Buffer.from('4286', 'hex')
const kEBMLReadVersion = Buffer.from('42F7', 'hex')
const kEBMLMaxIDLength = Buffer.from('42F2', 'hex')
const kEBMLMaxSizeLength = Buffer.from('42F3', 'hex')
const kDocType = Buffer.from('4282', 'hex')
const kDocTypeVersion = Buffer.from('4287', 'hex')
const kDocTypeReadVersion = Buffer.from('4285', 'hex')
const kSegment = Buffer.from('18538067', 'hex')
const kInfo = Buffer.from('1549A966', 'hex')
const kTimestampScale = Buffer.from('2AD7B1', 'hex')
const kMuxingApp = Buffer.from('4D80', 'hex')
const kWritingApp = Buffer.from('5741', 'hex')
const kTracks = Buffer.from('1654AE6B', 'hex')
const kTrackEntry = Buffer.from('AE', 'hex')
const kTrackNumber = Buffer.from('D7', 'hex')
const kTrackUID = Buffer.from('73C5', 'hex')
const kTrackType = Buffer.from('83', 'hex')
const kFlagLacing = Buffer.from('9C', 'hex')
const kCodecID = Buffer.from('86', 'hex')
const kVideo = Buffer.from('E0', 'hex')
const kPixelWidth = Buffer.from('B0', 'hex')
const kPixelHeight = Buffer.from('BA', 'hex')
const kTimestamp = Buffer.from('E7', 'hex')
const kClusterId = 0x1f43b675
const kTimestampId = 0xe7
const kSimpleBlockId = 0xa3

// "Unknown size" for a streaming Segment: an 8-byte EBML vint with all data bits set.
const kUnknownSize = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])

// Per-frame SimpleBlock constants (each MJPEG frame is its own keyframe Cluster).
const kTrackNumberVint = Buffer.from([0x81]) // vint(1) — single video track, constant per frame.
const kRelativeTimecode = Buffer.from([0x00, 0x00]) // int16, always 0 within its Cluster.
const kKeyframeFlag = Buffer.from([0x80])

// Encodes a value as an EBML variable-length size integer (vint): the leading bits select
// the byte length and are followed by the big-endian value.
const vintLength = value => {
  let length = 1
  while (value >= 2 ** (7 * length) - 1) ++length
  return length
}

const writeVint = (buffer, offset, value, length = vintLength(value)) => {
  let v = value
  for (let i = length - 1; i >= 0; --i) {
    buffer[offset + i] = v & 0xff
    v = Math.floor(v / 256)
  }
  buffer[offset] |= 1 << (8 - length)
  return offset + length
}

const vint = value => {
  const buffer = Buffer.allocUnsafe(vintLength(value))
  writeVint(buffer, 0, value, buffer.length)
  return buffer
}

// Encodes a non-negative integer as a minimal big-endian byte sequence.
const uintLength = value => {
  let length = 1
  let v = value
  while (v >= 256) {
    ++length
    v = Math.floor(v / 256)
  }
  return length
}

const writeUInt = (buffer, offset, value, length = uintLength(value)) => {
  let v = value
  for (let i = length - 1; i >= 0; --i) {
    buffer[offset + i] = v & 0xff
    v = Math.floor(v / 256)
  }
  return offset + length
}

const uint = value => {
  const buffer = Buffer.allocUnsafe(uintLength(value))
  writeUInt(buffer, 0, value, buffer.length)
  return buffer
}

// A complete EBML element: id + size-as-vint + payload.
const element = (id, payload) => Buffer.concat([id, vint(payload.length), payload])

// Emits the Matroska header: EBML head, an unknown-size (streaming) Segment, stream Info with a
// 1ms timestamp scale, and a single MJPEG video track. Frames follow as Clusters.
const writeHeader = (width, height) => {
  const ebml = element(
    kEBML,
    Buffer.concat([
      element(kEBMLVersion, uint(1)),
      element(kEBMLReadVersion, uint(1)),
      element(kEBMLMaxIDLength, uint(4)),
      element(kEBMLMaxSizeLength, uint(8)),
      element(kDocType, Buffer.from('matroska')),
      element(kDocTypeVersion, uint(4)),
      element(kDocTypeReadVersion, uint(2))
    ])
  )
  const info = element(
    kInfo,
    Buffer.concat([
      // TimestampScale in nanoseconds per tick: 1_000_000 => timestamps in milliseconds.
      element(kTimestampScale, uint(1000000)),
      element(kMuxingApp, Buffer.from('browserless')),
      element(kWritingApp, Buffer.from('browserless'))
    ])
  )
  const track = element(
    kTrackEntry,
    Buffer.concat([
      element(kTrackNumber, uint(1)),
      element(kTrackUID, uint(1)),
      element(kTrackType, uint(1)), // 1 = video.
      element(kFlagLacing, uint(0)),
      element(kCodecID, Buffer.from('V_MJPEG')),
      // PixelWidth/PixelHeight are advisory: ffmpeg's mjpeg decoder uses the dimensions encoded
      // in each JPEG frame, and the output video filters normalize to the requested size.
      element(
        kVideo,
        Buffer.concat([element(kPixelWidth, uint(width)), element(kPixelHeight, uint(height))])
      )
    ])
  )
  const tracks = element(kTracks, track)
  return Buffer.concat([ebml, kSegment, kUnknownSize, info, tracks])
}

// Emits the bytes that precede a single MJPEG frame in its own Cluster, timestamped at the given
// absolute millisecond offset. The frame itself is NOT copied here - the caller writes this header
// followed by the raw frame buffer, so the (potentially large) JPEG is never duplicated.
const writeClusterHeader = (timestampMs, frameLength) => {
  const blockPayloadLength = 4 + frameLength
  const blockSizeLength = vintLength(blockPayloadLength)
  const timestampLength = uintLength(timestampMs)
  const timestampSizeLength = vintLength(timestampLength)
  const timestampElementLength = kTimestamp.length + timestampSizeLength + timestampLength
  const simpleBlockHeaderLength =
    1 + blockSizeLength + kTrackNumberVint.length + kRelativeTimecode.length + kKeyframeFlag.length
  const clusterPayloadLength = timestampElementLength + simpleBlockHeaderLength + frameLength
  const clusterSizeLength = vintLength(clusterPayloadLength)
  const buffer = Buffer.allocUnsafe(
    4 + clusterSizeLength + timestampElementLength + simpleBlockHeaderLength
  )

  let offset = 0
  buffer.writeUInt32BE(kClusterId, offset)
  offset += 4
  offset = writeVint(buffer, offset, clusterPayloadLength, clusterSizeLength)
  buffer[offset++] = kTimestampId
  offset = writeVint(buffer, offset, timestampLength, timestampSizeLength)
  offset = writeUInt(buffer, offset, timestampMs, timestampLength)
  buffer[offset++] = kSimpleBlockId
  offset = writeVint(buffer, offset, blockPayloadLength, blockSizeLength)
  buffer[offset++] = 0x81
  buffer[offset++] = 0x00
  buffer[offset++] = 0x00
  buffer[offset++] = 0x80

  return buffer
}

module.exports = { writeHeader, writeClusterHeader }
