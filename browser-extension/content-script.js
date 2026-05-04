(function () {
  if (window.__aiChatUiTabBridgeInstalled) {
    return
  }

  function isPrivateHostname(hostname) {
    return /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
      || hostname === 'localhost'
      || hostname === '127.0.0.1'
  }

  function isAllowedAppPage(locationLike) {
    return locationLike.protocol.startsWith('http')
      && locationLike.port === '5183'
      && isPrivateHostname(locationLike.hostname)
  }

  if (!isAllowedAppPage(window.location)) {
    return
  }

  window.__aiChatUiTabBridgeInstalled = true

  window.postMessage({
    source: 'ai-chat-ui-extension',
    type: 'READY',
  }, '*')

  window.addEventListener('message', async (event) => {
    if (event.source !== window) {
      return
    }

    const data = event.data
    if (!data || data.source !== 'ai-chat-ui' || typeof data.requestId !== 'string') {
      return
    }

    if (data.type === 'PING') {
      window.postMessage({
        source: 'ai-chat-ui-extension',
        type: 'PONG',
        requestId: data.requestId,
        payload: { ok: true },
      }, '*')
      return
    }

    try {
      const payload = await chrome.runtime.sendMessage({
        type: data.type,
        payload: data.payload || {},
      })

      if (payload && payload.__error) {
        throw new Error(payload.message || 'Extension request failed.')
      }

      window.postMessage({
        source: 'ai-chat-ui-extension',
        requestId: data.requestId,
        payload,
      }, '*')
    } catch (error) {
      window.postMessage({
        source: 'ai-chat-ui-extension',
        requestId: data.requestId,
        error: error instanceof Error ? error.message : String(error),
      }, '*')
    }
  })
})()