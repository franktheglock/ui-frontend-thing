import { Router } from 'express'
import { getClientIp, isLoopbackAddress } from '../utils/path-safety'
import {
  collectLanHints,
  getEnvAuthToken,
  loadNetworkSecurity,
  saveNetworkSecurity,
} from '../network-security'
import { getListenInfo, setLanBindEnabled } from '../listen-control'

const router = Router()

/** Simple per-IP rate limit for unlock guesses. */
const unlockAttempts = new Map<string, { count: number; resetAt: number }>()
const UNLOCK_WINDOW_MS = 60_000
const UNLOCK_MAX_ATTEMPTS = 10

function rateLimitUnlock(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now()
  let entry = unlockAttempts.get(ip)
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + UNLOCK_WINDOW_MS }
    unlockAttempts.set(ip, entry)
  }
  entry.count += 1
  if (entry.count > UNLOCK_MAX_ATTEMPTS) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) }
  }
  return { ok: true }
}

function extractToken(req: { headers: Record<string, unknown>; body?: any }): string {
  const header = req.headers.authorization
  const bearer =
    typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : ''
  const xToken = String(req.headers['x-api-token'] || '').trim()
  const bodyToken = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
  return bearer || xToken || bodyToken
}

function isAuthorized(
  req: any,
  settings: Awaited<ReturnType<typeof loadNetworkSecurity>>,
): boolean {
  const envToken = getEnvAuthToken()
  const clientIp = getClientIp(req)
  const isLocal = isLoopbackAddress(clientIp)
  const provided = extractToken(req)

  if (envToken) {
    return provided === envToken
  }
  if (isLocal) return true
  if (settings.lanAccessEnabled && !settings.requireToken) return true
  if (settings.apiAuthToken && provided === settings.apiAuthToken) return true
  return false
}

/** Full view — only for authorized callers. */
function fullNetworkView(
  settings: Awaited<ReturnType<typeof loadNetworkSecurity>>,
  opts: { revealToken: boolean },
) {
  const listen = getListenInfo()
  const envToken = getEnvAuthToken()
  const lanUrls = collectLanHints(listen.port)

  return {
    lanAccessEnabled: settings.lanAccessEnabled,
    requireToken: settings.requireToken || !!envToken,
    hasToken: !!(envToken || settings.apiAuthToken),
    tokenSource: envToken
      ? ('env' as const)
      : settings.apiAuthToken
        ? ('settings' as const)
        : ('none' as const),
    apiAuthToken: opts.revealToken && !envToken ? settings.apiAuthToken : '',
    envTokenLocked: !!envToken,
    listenHost: listen.host,
    listenPort: listen.port,
    hostLocked: listen.hostLocked,
    lanBindActive: listen.host === '0.0.0.0' || listen.host === '::',
    lanUrls,
    notes: buildNotes(settings, listen, envToken, lanUrls),
  }
}

/** Minimal public view — no interface addresses, no token material. */
function publicNetworkView(settings: Awaited<ReturnType<typeof loadNetworkSecurity>>) {
  const listen = getListenInfo()
  const envToken = getEnvAuthToken()
  return {
    lanAccessEnabled: settings.lanAccessEnabled,
    requireToken: !!envToken || (settings.lanAccessEnabled && settings.requireToken),
    hasToken: !!(envToken || settings.apiAuthToken),
    envTokenLocked: !!envToken,
    hostLocked: listen.hostLocked,
    // Deliberately omit lanUrls, listenHost details beyond port, notes, apiAuthToken
    listenPort: listen.port,
  }
}

function buildNotes(
  settings: Awaited<ReturnType<typeof loadNetworkSecurity>>,
  listen: ReturnType<typeof getListenInfo>,
  envToken: string,
  lanUrls: string[],
): string[] {
  const notes: string[] = []
  if (!settings.lanAccessEnabled) {
    notes.push('LAN access is off. Other devices on your network cannot use this UI in a browser.')
  } else {
    notes.push('LAN access is on. Private-network browser origins are allowed by CORS.')
    if (settings.requireToken || envToken) {
      notes.push('Other devices must send the access token (the UI stores it after you enter it once).')
    } else {
      notes.push('Token is not required — any device on your LAN can use the API. Prefer a trusted network.')
    }
  }
  if (listen.hostLocked) {
    notes.push(
      `HOST=${listen.host} is set (e.g. Docker). Keep compose ports on 127.0.0.1 unless you intentionally enable LAN.`,
    )
  } else if (settings.lanAccessEnabled && listen.host !== '0.0.0.0' && listen.host !== '::') {
    notes.push('Server is still bound to loopback only — rebind may have failed. Set HOST=0.0.0.0 and restart.')
  }
  if (envToken) {
    notes.push('API_AUTH_TOKEN is set in the environment and overrides the Settings token for all clients.')
  }
  if (settings.lanAccessEnabled && lanUrls.length > 0) {
    notes.push(`Try: ${lanUrls[0]}`)
  }
  return notes
}

/** GET /api/network — public minimal status; full details only when authorized. */
router.get('/', async (req, res) => {
  try {
    const settings = await loadNetworkSecurity()
    const authorized = isAuthorized(req, settings)
    if (!authorized) {
      return res.json(publicNetworkView(settings))
    }
    res.json(fullNetworkView(settings, { revealToken: true }))
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load network settings' })
  }
})

/** POST /api/network/unlock — validate a token (rate-limited). */
router.post('/unlock', async (req, res) => {
  try {
    const clientIp = getClientIp(req) || 'unknown'
    const limit = rateLimitUnlock(clientIp)
    if (!limit.ok) {
      res.setHeader('Retry-After', String(limit.retryAfterSec))
      return res.status(429).json({
        ok: false,
        error: 'Too many unlock attempts. Try again later.',
        retryAfterSec: limit.retryAfterSec,
      })
    }

    const settings = await loadNetworkSecurity()
    const envToken = getEnvAuthToken()
    const { hostLocked } = getListenInfo()
    const expected = envToken || settings.apiAuthToken
    const provided = String(req.body?.token || '').trim()

    const tokenRequired =
      !!envToken || (settings.lanAccessEnabled && settings.requireToken)

    if (!tokenRequired || !expected) {
      return res.json({
        ok: true,
        required: false,
        ...publicNetworkView(settings),
      })
    }

    if (provided !== expected) {
      return res.status(401).json({ ok: false, error: 'Invalid access token' })
    }

    // Successful unlock — reset rate limit for this IP
    unlockAttempts.delete(clientIp)

    res.json({
      ok: true,
      required: true,
      ...fullNetworkView(settings, { revealToken: !envToken }),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Unlock failed' })
  }
})

/** PATCH /api/network — update LAN settings (authorized only). */
router.patch('/', async (req, res) => {
  try {
    const settings = await loadNetworkSecurity()
    if (!isAuthorized(req, settings)) {
      return res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
    }

    const body = req.body || {}
    const next = await saveNetworkSecurity({
      lanAccessEnabled:
        body.lanAccessEnabled !== undefined ? !!body.lanAccessEnabled : undefined,
      requireToken: body.requireToken !== undefined ? !!body.requireToken : undefined,
      apiAuthToken: typeof body.apiAuthToken === 'string' ? body.apiAuthToken : undefined,
      regenerateToken: body.regenerateToken === true,
    })

    // When HOST is locked, ensure a token exists if LAN is on
    const listen = getListenInfo()
    let finalSettings = next
    if (listen.hostLocked && next.lanAccessEnabled && !next.apiAuthToken && !getEnvAuthToken()) {
      finalSettings = await saveNetworkSecurity({ regenerateToken: true })
    }

    try {
      await setLanBindEnabled(finalSettings.lanAccessEnabled)
    } catch (err: any) {
      console.error('[network] rebind failed:', err.message)
    }

    res.json({
      ...fullNetworkView(finalSettings, { revealToken: true }),
      rebound: !listen.hostLocked,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update network settings' })
  }
})

export default router
