'use strict'

const test = require('ava')

const { writeHeader, writeClusterHeader } = require('../src/ebml')

test('writeHeader starts with the EBML magic and declares matroska/MJPEG', t => {
  const header = writeHeader(1280, 800)
  t.true(Buffer.isBuffer(header))
  // EBML magic.
  t.is(header.subarray(0, 4).toString('hex'), '1a45dfa3')
  // DocType "matroska" and the MJPEG codec id are present in the header.
  t.true(header.includes(Buffer.from('matroska')))
  t.true(header.includes(Buffer.from('V_MJPEG')))
})

test('writeClusterHeader encodes the cluster timestamp', t => {
  const frameLength = 1234
  const cluster = writeClusterHeader(500, frameLength)
  t.true(Buffer.isBuffer(cluster))
  // Cluster element id.
  t.is(cluster.subarray(0, 4).toString('hex'), '1f43b675')
  // The cluster carries a Timestamp element (E7) holding 500 (0x01F4).
  const ts = Buffer.from([0xe7, 0x82, 0x01, 0xf4])
  t.true(cluster.includes(ts))
  // SimpleBlock (A3) declares its size as 4 (block header) + frameLength.
  t.true(cluster.includes(Buffer.from([0xa3])))
})

test('cluster header does not embed the frame payload (no duplication)', t => {
  // The frame buffer is written separately by the caller, so the header length
  // must be independent of frameLength beyond the size vints.
  const small = writeClusterHeader(0, 10)
  const large = writeClusterHeader(0, 10_000_000)
  // Only the SimpleBlock size vint grows; the header never carries 10MB.
  t.true(small.length < 32)
  t.true(large.length < 32)
})
