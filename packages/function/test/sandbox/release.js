'use strict'

const test = require('ava')

const SANDBOX = require.resolve('../../src/sandbox')
const GATEWAY = require.resolve('../../src/sandbox/gateway')

const withGateway = (t, grant) => {
  const original = require.cache[GATEWAY]
  require.cache[GATEWAY] = { id: GATEWAY, filename: GATEWAY, loaded: true, exports: { grant } }
  delete require.cache[SANDBOX]
  t.teardown(() => {
    delete require.cache[SANDBOX]
    if (original) require.cache[GATEWAY] = original
    else delete require.cache[GATEWAY]
  })
  return require(SANDBOX)
}

test('release revokes every grant it holds', async t => {
  const revoked = []
  let issued = 0
  const createSandbox = withGateway(t, async () => {
    const id = String(++issued)
    return { endpoint: `ws://sandbox/${id}`, revoke: async () => revoked.push(id) }
  })
  const sandbox = createSandbox()

  await sandbox.grant({})
  await sandbox.grant({})
  await sandbox.release()

  t.deepEqual(revoked.sort(), ['1', '2'])
})

test('a grant that lands after release is revoked instead of left open', async t => {
  const revoked = []
  let land
  const landed = new Promise(resolve => {
    land = resolve
  })
  const createSandbox = withGateway(t, async () => {
    await landed
    return { endpoint: 'ws://sandbox/late', revoke: async () => revoked.push('late') }
  })
  const sandbox = createSandbox()

  const pending = sandbox.grant({})
  await sandbox.release()
  land()
  await pending

  t.deepEqual(revoked, ['late'])
})
