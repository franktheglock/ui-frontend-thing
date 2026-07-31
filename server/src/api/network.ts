import { Router } from 'express'
import { isLoopbackAddress } from '../utils/path-safety'
import {
  collectLanHints,
  getEnvAuthToken,
  loadNetworkSecurity,
  saveNetworkSecurity,
} from '../network-security'
import { getListenInfo, setLanBindEnabled } from '../listen-control'

const router = Router()

function publicNetworkView(
  settings: Awaited<ReturnType<typeof loadNetworkSecurity>>,
  opts: { revealToken: boolean },
) {
  const listen = getListenInfo()
  const envToken = getEnvAuthToken()
  const lanUrls = collectLanHints(listen.port)

  return {
    lanAccessEnabled: settings.lanAccessEnabled,
    requireToken: settings.requireToken,
    hasToken: !!(envToken || settings.apiAuthToken),
    tokenSource: envToken ? ('env' as const) : settings.apiAuthToken ? ('settings' as const) : ('none' as const),
    // Only reveal token to authorized/local clients
    apiAuthToken: opts.revealToken && !envToken ? settings.apiAuthToken : '',
    envTokenLocked: !!envToken,
    listenHost: listen.host,
    listenPort: listen.port,
    hostLocked: listen.hostLocked,
    lanBindActive: listen.host === '0.0.0.0' || listen.host === '::',
    lanUrls,
    // Human-readable notes for the UI
    notes: buildNotes(settings, listen, envToken, lanUrls),
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
    if (settings.requireToken) {
      notes.push('Other devices must send the access token (the UI stores it after you enter it once).')
    } else {
      notes.push('Token is not required — any device on your LAN can use the API. Prefer a trusted network.')
    }
  }
  if (listen.hostLocked) {
    notes.push(`Listen address is fixed by HOST=${listen.host} (e.g. Docker). Toggle will not rebind.`)
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

/** GET /api/network — status (token only revealed to loopback or authorized callers). */
router.get('/', async (req, res) => {
  try {
    const settings = await loadNetworkSecurity()
    const envToken = getEnvAuthToken()
    const isLocal = isLoopbackAddress(req.socket.remoteAddress)
    const provided =
      (typeof req.headers.authorization === 'string' &&
      req.headers.authorization.toLowerCase().startsWith('bearer ')
        ? req.headers.authorization.slice(7).trim()
        : '') || String(req.headers['x-api-token'] || '').trim()

    const expected = envToken || settings.apiAuthToken
    const authorized = isLocal || (!!expected && provided === expected) || (settings.lanAccessEnabled && !settings.requireToken && !envToken)

    res.json(publicNetworkView(settings, { revealToken: authorized }))
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load network settings' })
  }
})

/** POST /api/network/unlock — validate a token and return status (for LAN unlock screen). */
router.post('/unlock', async (req, res) => {
  try {
    const settings = await loadNetworkSecurity()
    const envToken = getEnvAuthToken()
    const expected = envToken || settings.apiAuthToken
    const provided = String(req.body?.token || '').trim()

    if (!expected) {
      return res.json({ ok: true, required: false, ...publicNetworkView(settings, { revealToken: false }) })
    }

    if (provided !== expected) {
      return res.status(401).json({ ok: false, error: 'Invalid access token' })
    }

    res.json({
      ok: true,
      required: true,
      ...publicNetworkView(settings, { revealToken: !envToken }),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Unlock failed' })
  }
})

/** PATCH /api/network — update LAN settings (loopback or authorized only). */
router.patch('/', async (req, res) => {
  try {
    const settings = await loadNetworkSecurity()
    const envToken = getEnvAuthToken()
    const isLocal = isLoopbackAddress(req.socket.remoteAddress)
    const provided =
      (typeof req.headers.authorization === 'string' &&
      req.headers.authorization.toLowerCase().startsWith('bearer ')
        ? req.headers.authorization.slice(7).trim()
        : '') || String(req.headers['x-api-token'] || '').trim()

    const expected = envToken || (settings.requireToken ? settings.apiAuthToken : '')
    const authorized =
      isLocal ||
      (!!expected && provided === expected) ||
      (settings.lanAccessEnabled && !settings.requireToken && !envToken)

    if (!authorized) {
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

    // Rebind listen address when HOST is not locked by env
    try {
      await setLanBindEnabled(next.lanAccessEnabled)
    } catch (err: any) {
      console.error('[network] rebind failed:', err.message)
    }

    const listen = getListenInfo()
    res.json({
      ...publicNetworkView(next, { revealToken: true }),
      rebound: !listen.hostLocked,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update network settings' })
  }
})

export default router
