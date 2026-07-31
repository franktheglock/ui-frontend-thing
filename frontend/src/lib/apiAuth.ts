const TOKEN_KEY = 'ai-chat-ui-api-token'

export function getApiToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setApiToken(token: string) {
  try {
    if (token && token.trim()) {
      localStorage.setItem(TOKEN_KEY, token.trim())
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  } catch {
    // ignore
  }
}

export function clearApiToken() {
  setApiToken('')
}

function isApiUrl(url: string): boolean {
  if (!url) return false
  if (url.startsWith('/api')) return true
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api')
  } catch {
    return false
  }
}

/**
 * Patch window.fetch so every same-origin /api request includes the access token
 * when one is stored (LAN token or env-backed token entered in the unlock UI).
 */
export function installApiAuthFetch() {
  if (typeof window === 'undefined') return
  const w = window as Window & { __apiAuthFetchInstalled?: boolean }
  if (w.__apiAuthFetchInstalled) return
  w.__apiAuthFetchInstalled = true

  const original = window.fetch.bind(window)

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url

    if (!isApiUrl(url)) {
      return original(input, init)
    }

    const token = getApiToken()
    if (!token) {
      return original(input, init)
    }

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
    if (!headers.has('X-API-Token') && !headers.has('Authorization')) {
      headers.set('X-API-Token', token)
    }

    return original(input, { ...init, headers })
  }
}
