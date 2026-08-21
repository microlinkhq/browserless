'use strict'

const createAi = require('..')

const url = process.argv[2] || 'https://example.com'
const text = process.argv[3] || 'Hello, how are you today?'

const main = async () => {
  const ai = createAi()
  try {
    console.log(await ai.capabilities({ url }))
    console.log(await ai.detectLanguage(url, { text }))
  } finally {
    await ai.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
