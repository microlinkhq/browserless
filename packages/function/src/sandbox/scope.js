'use strict'

const { isTopLevelTarget, matchesFilter, denial, scoped } = require('./policy')

const SERVER_ERROR = -32000
const SESSION_NOT_FOUND = -32001
const INVALID_REQUEST = -32600
const INVALID_PARAMS = -32602

const DISCOVER_EVERY_TARGET = { discover: true, filter: [{}] }

const isProtocolEvent = method => typeof method === 'string' && method.includes('.')

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

const isTargetFilter = filter =>
  filter === undefined || (Array.isArray(filter) && filter.every(isPlainObject))

const protocolError = (message, code = SERVER_ERROR) => Object.assign(new Error(message), { code })

const toErrorPayload = error => ({
  code: Number.isInteger(error.code) ? error.code : SERVER_ERROR,
  message: error.originalMessage || error.message
})

const parseCommand = raw => {
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }
  if (!isPlainObject(message)) return
  const { id, method, params = {}, sessionId } = message
  if (!Number.isInteger(id) || typeof method !== 'string' || !isPlainObject(params)) return
  if (sessionId !== undefined && typeof sessionId !== 'string') return
  return { id, method, params, sessionId }
}

module.exports = async ({ root, browserContextId, send, close, onDenied }) => {
  const connection = root.connection()
  const sessions = new Map()
  const discoveredTargets = new Map()
  const browserTargets = new Map()
  const ownedTargetIds = new Set()
  const autoAttachedTargetIds = new Set()
  let discovery
  let autoAttachment
  let isDisposed = false

  const scope = {
    browserContextId,
    ownsTarget: targetId => ownedTargetIds.has(targetId),
    ownsSession: sessionId => sessions.has(sessionId)
  }

  const announce = (method, targetInfo) => {
    if (discovery && matchesFilter(discovery.filter, targetInfo.type)) {
      send({ method, params: { targetInfo } })
    }
  }

  const autoAttach = async ({ targetId, type }) => {
    if (!autoAttachment || autoAttachedTargetIds.has(targetId)) return
    if (!isTopLevelTarget(type) || !matchesFilter(autoAttachment.filter, type)) return
    autoAttachedTargetIds.add(targetId)
    await root.send('Target.attachToTarget', { targetId, flatten: true }).catch(() => {})
  }

  const onSessionEvent = (emitter, method, params) => {
    if (isDisposed || !isProtocolEvent(method)) return
    if (method === 'Target.attachedToTarget') {
      const session = connection.session(params.sessionId)
      if (!session) return
      sessions.set(params.sessionId, { session, parent: emitter })
      ownedTargetIds.add(params.targetInfo.targetId)
      session.on('*', (childMethod, childParams) =>
        onSessionEvent(session, childMethod, childParams)
      )
    }
    if (method === 'Target.detachedFromTarget') sessions.delete(params.sessionId)
    send({ method, params, sessionId: emitter === root ? undefined : emitter.id() })
  }

  const onTargetInfo = (method, { targetInfo }) => {
    if (targetInfo.type === 'browser') {
      browserTargets.set(targetInfo.targetId, targetInfo)
      return announce(method, targetInfo)
    }
    if (targetInfo.browserContextId !== browserContextId) return
    discoveredTargets.set(targetInfo.targetId, targetInfo)
    ownedTargetIds.add(targetInfo.targetId)
    announce(method, targetInfo)
    if (method === 'Target.targetCreated') autoAttach(targetInfo)
  }

  const onTargetGone = (method, params) => {
    if (!ownedTargetIds.has(params.targetId)) return
    if (method === 'Target.targetDestroyed') {
      discoveredTargets.delete(params.targetId)
      ownedTargetIds.delete(params.targetId)
      autoAttachedTargetIds.delete(params.targetId)
    }
    if (discovery) send({ method, params })
  }

  const onRootSessionEvent = (method, params) => onSessionEvent(root, method, params)

  const rootEvents = {
    'Target.targetCreated': onTargetInfo,
    'Target.targetInfoChanged': onTargetInfo,
    'Target.targetDestroyed': onTargetGone,
    'Target.targetCrashed': onTargetGone,
    'Target.attachedToTarget': onRootSessionEvent,
    'Target.detachedFromTarget': onRootSessionEvent
  }

  const onRootEvent = (method, params) => {
    if (!isDisposed) rootEvents[method]?.(method, params)
  }

  const emulatedRootCommands = {
    'Browser.close': async () => {
      setImmediate(close)
      return {}
    },
    'Target.getBrowserContexts': async () => ({ browserContextIds: [browserContextId] }),
    'Target.setDiscoverTargets': async ({ discover, filter = [{}] }) => {
      if (!isTargetFilter(filter)) throw protocolError('Invalid parameters', INVALID_PARAMS)
      discovery = discover ? { filter } : undefined
      for (const targetInfo of [...browserTargets.values(), ...discoveredTargets.values()]) {
        announce('Target.targetCreated', targetInfo)
      }
      return {}
    },
    'Target.setAutoAttach': async ({ autoAttach: isEnabled, filter }) => {
      if (!isTargetFilter(filter)) throw protocolError('Invalid parameters', INVALID_PARAMS)
      autoAttachment = isEnabled ? { filter } : undefined
      await Promise.all([...discoveredTargets.values()].map(autoAttach))
      return {}
    },
    'Target.getTargets': async params => {
      const { targetInfos } = await root.send('Target.getTargets', params)
      return { targetInfos: targetInfos.filter(({ targetId }) => ownedTargetIds.has(targetId)) }
    },
    'Target.createTarget': async params => {
      const result = await root.send('Target.createTarget', params)
      ownedTargetIds.add(result.targetId)
      return result
    }
  }

  const execute = async ({ method, params, sessionId }) => {
    const isRoot = sessionId === undefined
    const session = isRoot ? root : sessions.get(sessionId)?.session
    if (!session) throw protocolError('Session with given id not found.', SESSION_NOT_FOUND)
    const reason = denial({ method, params, isRoot }, scope)
    if (reason) {
      onDenied({ method, reason })
      throw protocolError(reason)
    }
    const scopedParams = scoped(method, params, browserContextId)
    const emulate = isRoot && emulatedRootCommands[method]
    return emulate ? emulate(scopedParams) : session.send(method, scopedParams)
  }

  const handle = raw => {
    const command = parseCommand(raw)
    if (!command) {
      return send({ error: { code: INVALID_REQUEST, message: 'Message must be a valid command' } })
    }
    const { id, sessionId } = command
    execute(command).then(
      result => send({ id, result, sessionId }),
      error => send({ id, error: toErrorPayload(error), sessionId })
    )
  }

  const detachDescendantsFirst = async () => {
    const attachedLast = [...sessions].reverse()
    sessions.clear()
    for (const [sessionId, { parent }] of attachedLast) {
      await parent.send('Target.detachFromTarget', { sessionId }).catch(() => {})
    }
  }

  const dispose = async () => {
    if (isDisposed) return
    isDisposed = true
    root.off('*', onRootEvent)
    await detachDescendantsFirst()
    await root.detach().catch(() => {})
  }

  root.on('*', onRootEvent)
  await root.send('Target.setDiscoverTargets', DISCOVER_EVERY_TARGET)

  return { handle, dispose }
}
