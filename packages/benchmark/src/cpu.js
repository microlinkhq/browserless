'use strict'

const sieveOfErathosthenes = require('sieve-of-eratosthenes')
const bench = require('nanobench')

const N = process.argv[2] || 1000

const ITERATIONS = [...Array(N).keys()]

bench('calculate a sieve value', async function (b) {
  b.start()
  for (const i in ITERATIONS) {
    sieveOfErathosthenes(33554432).length === 2063689
  }
  b.end()
})
