'use strict'

const NAVIGABLE_PROTOCOLS = new Set(['http:', 'https:', 'about:', 'data:', 'blob:'])

const DEFAULT_TARGET_FILTER = [
  { type: 'browser', exclude: true },
  { type: 'tab', exclude: true },
  {}
]

const NESTED_TARGET_TYPES = new Set(['iframe', 'worker'])

const SESSION_DOMAINS = new Set([
  'Accessibility',
  'Animation',
  'Audits',
  'Autofill',
  'CSS',
  'CacheStorage',
  'Console',
  'DOM',
  'DOMDebugger',
  'DOMSnapshot',
  'DOMStorage',
  'Debugger',
  'DeviceAccess',
  'DeviceOrientation',
  'Emulation',
  'EventBreakpoints',
  'Fetch',
  'HeapProfiler',
  'IO',
  'IndexedDB',
  'Input',
  'Inspector',
  'LayerTree',
  'Log',
  'Media',
  'Network',
  'Overlay',
  'Page',
  'Performance',
  'PerformanceTimeline',
  'Profiler',
  'Runtime',
  'Schema',
  'Security',
  'ServiceWorker',
  'Storage',
  'WebAudio',
  'WebAuthn'
])

const SESSION_METHODS = new Set([
  'Browser.getVersion',
  'Browser.grantPermissions',
  'Browser.resetPermissions',
  'Browser.setPermission',
  'Target.detachFromTarget',
  'Target.getTargetInfo',
  'Target.setAutoAttach'
])

const ROOT_METHODS = new Set([
  'Browser.close',
  'Browser.getVersion',
  'Browser.grantPermissions',
  'Browser.resetPermissions',
  'Browser.setPermission',
  'Storage.clearCookies',
  'Storage.getCookies',
  'Storage.setCookies',
  'Target.activateTarget',
  'Target.attachToTarget',
  'Target.closeTarget',
  'Target.createTarget',
  'Target.detachFromTarget',
  'Target.getBrowserContexts',
  'Target.getTargetInfo',
  'Target.getTargets',
  'Target.setAutoAttach',
  'Target.setDiscoverTargets'
])

const LOCAL_FILE_METHODS = new Set([
  'DOM.getFileInfo',
  'DOM.setFileInputFiles',
  'Network.loadNetworkResource',
  'Page.handleFileChooser',
  'Page.setDownloadBehavior'
])

const SHARED_SCREEN_METHODS = new Set([
  'Emulation.addScreen',
  'Emulation.getScreenInfos',
  'Emulation.removeScreen',
  'Emulation.setPrimaryScreen',
  'Emulation.updateScreen'
])

const CONTEXT_BOUND_METHODS = new Set([
  'Browser.grantPermissions',
  'Browser.resetPermissions',
  'Browser.setPermission',
  'Storage.clearCookies',
  'Storage.getCookies',
  'Storage.setCookies',
  'Target.createTarget'
])

const URL_PARAM_METHODS = new Set([
  'Fetch.continueRequest',
  'Network.continueInterceptedRequest',
  'Page.navigate',
  'Target.createTarget'
])

const isNavigable = url =>
  typeof url === 'string' && NAVIGABLE_PROTOCOLS.has(URL.parse(url)?.protocol)

const domainOf = method => method.slice(0, method.indexOf('.'))

const isAllowedMethod = (method, isRoot) => {
  if (isRoot) return ROOT_METHODS.has(method)
  if (LOCAL_FILE_METHODS.has(method) || SHARED_SCREEN_METHODS.has(method)) return false
  return SESSION_METHODS.has(method) || SESSION_DOMAINS.has(domainOf(method))
}

const dragsLocalFiles = (method, params) =>
  method === 'Input.dispatchDragEvent' && params.data?.files?.length > 0

const denial = ({ method, params, isRoot }, scope) => {
  if (!isAllowedMethod(method, isRoot)) return `'${method}' is not available to functions`
  if (dragsLocalFiles(method, params)) return `'${method}' cannot carry local files`
  if (URL_PARAM_METHODS.has(method) && params.url !== undefined && !isNavigable(params.url)) {
    return `'${method}' only accepts http, https, about, data and blob URLs`
  }
  if (params.browserContextId !== undefined && params.browserContextId !== scope.browserContextId) {
    return `Failed to find browser context with id ${params.browserContextId}`
  }
  if (params.targetId !== undefined && !scope.ownsTarget(params.targetId)) {
    return 'No target with given id found'
  }
  if (
    method.startsWith('Target.') &&
    params.sessionId !== undefined &&
    !scope.ownsSession(params.sessionId)
  ) {
    return 'No session with given id'
  }
}

const scoped = (method, params, browserContextId) => {
  if (CONTEXT_BOUND_METHODS.has(method)) return { ...params, browserContextId }
  if (method === 'Target.attachToTarget') return { ...params, flatten: true }
  return params
}

const matchesFilter = (filter = DEFAULT_TARGET_FILTER, type) => {
  const entry = filter.find(candidate => candidate.type === undefined || candidate.type === type)
  return entry !== undefined && !entry.exclude
}

const isTopLevelTarget = type => !NESTED_TARGET_TYPES.has(type)

module.exports = {
  denial,
  isAllowedMethod,
  isNavigable,
  isTopLevelTarget,
  matchesFilter,
  scoped
}
