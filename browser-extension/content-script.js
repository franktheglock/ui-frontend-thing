(function () {
  if (window.__aiChatUiTabBridgeInstalled) {
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