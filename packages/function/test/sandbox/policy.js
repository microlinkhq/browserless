'use strict'

const path = require('path')
const test = require('ava')
const fs = require('fs')

const {
  isTopLevelTarget,
  isAllowedMethod,
  matchesFilter,
  isNavigable,
  denial,
  scoped
} = require('../../src/sandbox/policy')

const OWN_CONTEXT = 'own-context'
const OWN_TARGET = 'own-target'
const OWN_SESSION = 'own-session'

const scope = {
  browserContextId: OWN_CONTEXT,
  ownsTarget: targetId => targetId === OWN_TARGET,
  ownsSession: sessionId => sessionId === OWN_SESSION
}

const onSession = (method, params = {}) => denial({ method, params, isRoot: false }, scope)
const onRoot = (method, params = {}) => denial({ method, params, isRoot: true }, scope)

const withFiles = { ...scope, allowFileAccess: true }
const onSessionWithFiles = (method, params = {}) =>
  denial({ method, params, isRoot: false }, withFiles)
const onRootWithFiles = (method, params = {}) => denial({ method, params, isRoot: true }, withFiles)

const METHODS_THE_ISOLATE_CLIENT_SENDS_AND_FUNCTIONS_LOSE = [
  'DOM.setFileInputFiles',
  'Target.createBrowserContext',
  'Target.disposeBrowserContext',
  'Tracing.end',
  'Tracing.start'
]

const sourceFilesOf = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'bidi' ? [] : sourceFilesOf(file)
    return file.endsWith('.js') && !file.endsWith('.test.js') ? [file] : []
  })

const methodsTheIsolateClientSends = () => {
  const isolateClient = path.dirname(require.resolve('@cloudflare/puppeteer/package.json'))
  const sources = [
    ...sourceFilesOf(path.join(isolateClient, 'lib/cjs/puppeteer')),
    require.resolve('../../src/template')
  ]
  const methods = new Set()
  for (const source of sources) {
    const sent = fs.readFileSync(source, 'utf8').matchAll(/\.send\(\s*['"]([A-Z]\w+\.\w+)['"]/g)
    for (const [, method] of sent) methods.add(method)
  }
  return [...methods].sort()
}

for (const method of [
  'DOM.setFileInputFiles',
  'DOM.getFileInfo',
  'Network.loadNetworkResource',
  'Page.setDownloadBehavior',
  'Page.handleFileChooser',
  'Browser.setDownloadBehavior',
  'Extensions.loadUnpacked',
  'FileSystem.getDirectory'
]) {
  test(`${method} cannot reach the local filesystem`, t => {
    t.is(onSession(method), `'${method}' is not available to functions`)
    t.is(onRoot(method), `'${method}' is not available to functions`)
  })
}

for (const method of [
  'Browser.crash',
  'Browser.crashGpuProcess',
  'Memory.simulatePressureNotification',
  'SystemInfo.getInfo',
  'Target.exposeDevToolsProtocol',
  'Target.attachToBrowserTarget',
  'Target.sendMessageToTarget',
  'Target.getTargets',
  'Tethering.bind',
  'Tracing.start'
]) {
  test(`${method} cannot reach past the page from a page session`, t => {
    t.is(onSession(method), `'${method}' is not available to functions`)
  })
}

for (const method of [
  'Browser.crash',
  'IO.read',
  'Page.navigate',
  'Runtime.evaluate',
  'Security.setIgnoreCertificateErrors',
  'Target.attachToBrowserTarget',
  'Target.createBrowserContext',
  'Target.disposeBrowserContext',
  'Tracing.start'
]) {
  test(`${method} is not a browser-level command a function can send`, t => {
    t.is(onRoot(method), `'${method}' is not available to functions`)
  })
}

for (const method of [
  'Runtime.evaluate',
  'Page.captureScreenshot',
  'Page.printToPDF',
  'IO.read',
  'Fetch.enable',
  'Network.getResponseBody',
  'Emulation.setDeviceMetricsOverride',
  'Input.dispatchMouseEvent',
  'Target.setAutoAttach',
  'Target.getTargetInfo'
]) {
  test(`${method} is available on a page session`, t => {
    t.is(onSession(method), undefined)
  })
}

test('every command the isolate client sends is allowed or knowingly denied', t => {
  const denied = methodsTheIsolateClientSends().filter(
    method => !isAllowedMethod(method, false) && !isAllowedMethod(method, true)
  )
  t.deepEqual(denied, METHODS_THE_ISOLATE_CLIENT_SENDS_AND_FUNCTIONS_LOSE)
})

test('a drag cannot carry local files', t => {
  const drag = files => ({
    type: 'drop',
    x: 0,
    y: 0,
    data: { items: [], files, dragOperationsMask: 1 }
  })
  t.is(
    onSession('Input.dispatchDragEvent', drag(['/etc/passwd'])),
    "'Input.dispatchDragEvent' cannot carry local files"
  )
  t.is(onSession('Input.dispatchDragEvent', drag([])), undefined)
  t.is(
    onSession('Input.dispatchDragEvent', { type: 'dragEnter', x: 0, y: 0, data: { items: [] } }),
    undefined
  )
})

for (const url of [
  'file:///etc/passwd',
  'FILE:///etc/passwd',
  'view-source:file:///etc/passwd',
  'chrome://version',
  'chrome-untrusted://terminal',
  'devtools://devtools/bundled/inspector.html',
  'filesystem:file:///temporary/a',
  'javascript:alert(1)',
  'about:crash',
  'about:gpucrash',
  'about:hang',
  'about:kill',
  'ABOUT:CRASH',
  'about://blank',
  '/etc/passwd',
  '',
  42
]) {
  test(`navigation to ${JSON.stringify(url)} is refused`, t => {
    t.false(isNavigable(url))
    for (const method of [
      'Page.navigate',
      'Fetch.continueRequest',
      'Network.continueInterceptedRequest'
    ]) {
      t.is(
        onSession(method, { url }),
        `'${method}' only accepts http, https, data, blob and about:blank URLs`
      )
    }
    t.is(
      onRoot('Target.createTarget', { url }),
      "'Target.createTarget' only accepts http, https, data, blob and about:blank URLs"
    )
  })
}

for (const url of [
  'https://example.com/',
  'http://example.com/',
  'about:blank',
  'about:blank#top',
  'about:blank?a=1',
  'data:text/html,hi',
  'blob:https://example.com/0f1e'
]) {
  test(`navigation to ${url} is allowed`, t => {
    t.true(isNavigable(url))
    t.is(onSession('Page.navigate', { url }), undefined)
    t.is(onRoot('Target.createTarget', { url }), undefined)
  })
}

test('a request can continue without overriding its url', t => {
  t.is(onSession('Fetch.continueRequest', { requestId: 'interception-1' }), undefined)
})

test('another browser context cannot be named', t => {
  t.is(
    onRoot('Storage.getCookies', { browserContextId: 'other-context' }),
    'Failed to find browser context with id other-context'
  )
  t.is(
    onSession('Storage.getCookies', { browserContextId: 'other-context' }),
    'Failed to find browser context with id other-context'
  )
  t.is(onRoot('Storage.getCookies', { browserContextId: OWN_CONTEXT }), undefined)
})

test('another target cannot be named', t => {
  for (const method of ['Target.attachToTarget', 'Target.closeTarget', 'Target.activateTarget']) {
    t.is(onRoot(method, { targetId: 'other-target' }), 'No target with given id found')
    t.is(onRoot(method, { targetId: OWN_TARGET }), undefined)
  }
  t.is(
    onSession('Target.getTargetInfo', { targetId: 'other-target' }),
    'No target with given id found'
  )
})

for (const method of [
  'Browser.getWindowBounds',
  'Browser.getWindowForTarget',
  'Browser.setWindowBounds'
]) {
  test(`${method} cannot reach another request's window`, t => {
    t.is(onSession(method, { windowId: 1 }), `'${method}' is not available to functions`)
    t.is(onRoot(method, { windowId: 1 }), `'${method}' is not available to functions`)
  })
}

for (const method of [
  'Emulation.addScreen',
  'Emulation.getScreenInfos',
  'Emulation.removeScreen',
  'Emulation.setPrimaryScreen',
  'Emulation.updateScreen'
]) {
  test(`${method} cannot change the screen every request shares`, t => {
    t.is(onSession(method, { screenId: '1' }), `'${method}' is not available to functions`)
    t.is(onRoot(method, { screenId: '1' }), `'${method}' is not available to functions`)
  })
}

test('per-page emulation stays available', t => {
  t.is(onSession('Emulation.setDeviceMetricsOverride'), undefined)
  t.is(onSession('Emulation.setTimezoneOverride'), undefined)
})

test('another session cannot be detached', t => {
  t.is(
    onRoot('Target.detachFromTarget', { sessionId: 'other-session' }),
    'No session with given id'
  )
  t.is(
    onSession('Target.detachFromTarget', { sessionId: 'other-session' }),
    'No session with given id'
  )
  t.is(onRoot('Target.detachFromTarget', { sessionId: OWN_SESSION }), undefined)
})

test('a screencast frame number is not mistaken for a session', t => {
  t.is(onSession('Page.screencastFrameAck', { sessionId: 7 }), undefined)
})

test('commands bound to a context always run against the own one', t => {
  for (const method of [
    'Browser.grantPermissions',
    'Browser.resetPermissions',
    'Browser.setPermission',
    'Storage.clearCookies',
    'Storage.getCookies',
    'Storage.setCookies',
    'Target.createTarget'
  ]) {
    t.deepEqual(scoped(method, { url: 'about:blank' }, OWN_CONTEXT), {
      url: 'about:blank',
      browserContextId: OWN_CONTEXT
    })
  }
})

test('an attach is always flat', t => {
  t.deepEqual(
    scoped('Target.attachToTarget', { targetId: OWN_TARGET, flatten: false }, OWN_CONTEXT),
    {
      targetId: OWN_TARGET,
      flatten: true
    }
  )
})

test('other commands keep their params untouched', t => {
  const params = { expression: '1' }
  t.is(scoped('Runtime.evaluate', params, OWN_CONTEXT), params)
})

test('a target filter decides on its first matching entry', t => {
  const tabsNotPages = [{ type: 'page', exclude: true }, {}]
  t.false(matchesFilter(tabsNotPages, 'page'))
  t.true(matchesFilter(tabsNotPages, 'tab'))
  t.true(matchesFilter([{ type: 'page' }], 'page'))
  t.false(matchesFilter([{ type: 'page' }], 'tab'))
  t.false(matchesFilter([], 'page'))
})

test('an omitted target filter excludes browser and tab targets', t => {
  t.false(matchesFilter(undefined, 'browser'))
  t.false(matchesFilter(undefined, 'tab'))
  t.true(matchesFilter(undefined, 'page'))
  t.true(matchesFilter(undefined, 'service_worker'))
})

test('frames and workers are attached by their page, not by the browser', t => {
  t.false(isTopLevelTarget('iframe'))
  t.false(isTopLevelTarget('worker'))
  t.true(isTopLevelTarget('tab'))
  t.true(isTopLevelTarget('page'))
  t.true(isTopLevelTarget('service_worker'))
})

test('with file access a page session may touch the local filesystem', t => {
  for (const method of [
    'DOM.setFileInputFiles',
    'DOM.getFileInfo',
    'Network.loadNetworkResource',
    'Page.handleFileChooser',
    'Page.setDownloadBehavior'
  ]) {
    t.is(onSessionWithFiles(method), undefined, method)
  }
  t.is(
    onSessionWithFiles('Input.dispatchDragEvent', {
      type: 'drop',
      x: 0,
      y: 0,
      data: { items: [], files: ['/etc/passwd'], dragOperationsMask: 1 }
    }),
    undefined
  )
})

test('with file access a function may navigate to a local file', t => {
  t.true(isNavigable('file:///etc/passwd', true))
  t.is(onSessionWithFiles('Page.navigate', { url: 'file:///etc/passwd' }), undefined)
  t.is(onRootWithFiles('Target.createTarget', { url: 'file:///etc/passwd' }), undefined)
})

test('file access still refuses what reaches every function on the browser', t => {
  for (const url of ['about:crash', 'about:gpucrash', 'chrome://version']) {
    t.false(isNavigable(url, true), url)
    t.is(
      onSessionWithFiles('Page.navigate', { url }),
      "'Page.navigate' only accepts http, https, data, blob and about:blank URLs"
    )
  }
  t.is(
    onSessionWithFiles('Emulation.updateScreen', { screenId: '1' }),
    "'Emulation.updateScreen' is not available to functions"
  )
  t.is(onSessionWithFiles('Tracing.start'), "'Tracing.start' is not available to functions")
  t.is(
    onSessionWithFiles('Storage.getCookies', { browserContextId: 'other-context' }),
    'Failed to find browser context with id other-context'
  )
  t.is(
    onRootWithFiles('Target.attachToTarget', { targetId: 'other-target' }),
    'No target with given id found'
  )
})
