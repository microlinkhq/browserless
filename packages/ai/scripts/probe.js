'use strict'

const createAi = require('..')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const main = async () => {
  const ai = createAi()
  try {
    let available
    for (let i = 0; i < 4; i++) {
      available = await ai.capabilities()
      console.log(JSON.stringify({ i, available }))
      if (available.languageModel === 'available') break
      await sleep(60000)
    }
    const language = await ai.detectLanguage('https://example.com', {
      text: 'Hello, how are you today?'
    })
    console.log(JSON.stringify({ language }))
    const reply = await ai.prompt('https://example.com', {
      prompt: 'Reply with the single word OK.'
    })
    console.log(JSON.stringify({ reply }))
  } finally {
    await ai.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
