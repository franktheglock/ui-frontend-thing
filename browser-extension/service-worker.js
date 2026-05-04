const MAX_SELECTION_CHARS = 12000
const MAX_TEXT_CHARS = 120000

function isPrivateHostname(hostname) {
  return /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    || hostname === 'localhost'
    || hostname === '127.0.0.1'
}

function isAppTabUrl(url) {
  try {
    const parsed = new URL(url)
    return /^https?:$/i.test(parsed.protocol)
      && parsed.port === '5183'
      && isPrivateHostname(parsed.hostname)
  } catch {
    return false
  }
}

function isCapturableUrl(url) {
  return /^https?:\/\//i.test(String(url || ''))
}

function normalizeText(value, maxChars) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars)
}

function getOriginPermissionPattern(url) {
  const parsed = new URL(url)
  return `${parsed.origin}/*`
}

async function ensureOriginPermission(url) {
  const originPattern = getOriginPermissionPattern(url)
  const hasPermission = await chrome.permissions.contains({
    origins: [originPattern],
  })

  if (hasPermission) {
    return true
  }

  try {
    return await chrome.permissions.request({
      origins: [originPattern],
    })
  } catch {
    return false
  }
}

async function injectBridgeIntoAppTabs() {
  const tabs = await chrome.tabs.query({})
  const appTabs = tabs.filter((tab) => typeof tab.id === 'number' && typeof tab.url === 'string' && isAppTabUrl(tab.url))

  await Promise.all(appTabs.map(async (tab) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-script.js'],
      })
    } catch {}
  }))
}

async function listTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true })

  return tabs
    .filter((tab) => typeof tab.id === 'number' && isCapturableUrl(tab.url))
    .map((tab) => ({
      id: tab.id,
      title: tab.title || 'Untitled tab',
      url: tab.url,
    }))
}

async function captureTab(tabId) {
  const tab = await chrome.tabs.get(tabId)
  if (!isCapturableUrl(tab.url)) {
    throw new Error('This tab cannot be imported. Only regular http and https pages are supported.')
  }

  const granted = await ensureOriginPermission(tab.url)
  if (!granted) {
    const hostname = new URL(tab.url).hostname
    throw new Error(`Site access was not granted for ${hostname}. Allow the extension on that site and try again.`)
  }

  let results
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selection = globalThis.getSelection ? globalThis.getSelection().toString() : ''
        const bodyText = document.body ? document.body.innerText : ''

        return {
          title: document.title || 'Untitled tab',
          url: location.href,
          selection,
          text: bodyText,
        }
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/Cannot access contents of the page|Cannot access a chrome:\/\//i.test(message)) {
      throw new Error('This tab is blocked by the browser and cannot be imported. Try a normal website tab instead.')
    }
    throw error
  }

  const result = results && results[0] ? results[0].result : null
  if (!result || !result.url) {
    throw new Error('Failed to capture tab content.')
  }

  return {
    title: result.title,
    url: result.url,
    selection: normalizeText(result.selection, MAX_SELECTION_CHARS),
    text: normalizeText(result.text, MAX_TEXT_CHARS),
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ;(async () => {
    if (!message || typeof message.type !== 'string') {
      throw new Error('Invalid extension request.')
    }

    if (message.type === 'LIST_TABS') {
      sendResponse(await listTabs())
      return
    }

    if (message.type === 'CAPTURE_TAB') {
      const tabId = Number(message.payload && message.payload.tabId)
      if (!Number.isInteger(tabId)) {
        throw new Error('tabId is required.')
      }

      sendResponse(await captureTab(tabId))
      return
    }

    throw new Error(`Unsupported extension request: ${message.type}`)
  })().catch((error) => {
    sendResponse({
      __error: true,
      message: error instanceof Error ? error.message : String(error),
    })
  })

  return true
})

chrome.runtime.onInstalled.addListener(() => {
  injectBridgeIntoAppTabs().catch(() => {})
})

chrome.runtime.onStartup.addListener(() => {
  injectBridgeIntoAppTabs().catch(() => {})
})