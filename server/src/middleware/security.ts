import type { CorsOptions } from 'cors'
import type { NextFunction, Request, Response } from 'express'
import { isLoopbackAddress } from '../utils/path-safety'
import {
  getEnvAuthToken,
  isPrivateNetworkOrigin,
  loadNetworkSecurity,
} from '../network-security'
import { getListenInfo } from '../listen-control'

function localhostAllowlist(): Set<string> {
  const raw = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || ''
  const defaults = [
    'http://localhost:3456',
    'http://127.0.0.1:3456',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ]
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const allowlist = new Set([...defaults, ...fromEnv])
  if (process.env.FRONTEND_ORIGIN) {
    allowlist.add(process.env.FRONTEND_ORIGIN.replace(/\/+$/, ''))
  }
  return allowlist
}

/**
 * Build CORS options.
 * - Always allows configured localhost / env origins.
 * - When LAN access is enabled in settings, also allows private-network origins.
 */
export function buildCorsOptions(): CorsOptions {
  const raw = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || ''

  if (raw.trim() === '*') {
    console.warn(
      '[security] CORS_ORIGIN=* allows any website to call this API. Prefer an explicit allowlist.',
    )
    return { origin: true, credentials: true }
  }

  const allowlist = localhostAllowlist()

  return {
    origin(origin, callback) {
      // Non-browser clients (curl, same-origin no Origin header) have no Origin
      if (!origin) {
        callback(null, true)
        return
      }
      if (allowlist.has(origin)) {
        callback(null, true)
        return
      }

      // Async check for LAN setting — cors supports async via callback
      loadNetworkSecurity()
        .then((settings) => {
          if (settings.lanAccessEnabled && isPrivateNetworkOrigin(origin)) {
            callback(null, true)
            return
          }
          callback(new Error(`CORS: origin not allowed: ${origin}`))
        })
        .catch(() => {
          callback(new Error(`CORS: origin not allowed: ${origin}`))
        })
    },
    credentials: true,
  }
}

function extractProvidedToken(req: Request): string {
  const header = req.headers.authorization
  const bearer =
    typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : ''
  const xToken = String(req.headers['x-api-token'] || '').trim()
  return bearer || xToken
}

/**
 * Auth + remote-access guard for /api/*.
 *
 * Priority:
 * 1. Env API_AUTH_TOKEN — always required for every client if set.
 * 2. LAN disabled — non-loopback clients rejected (when STRICT_LOCAL_ONLY or host is open).
 * 3. LAN enabled + requireToken — non-loopback clients must present the settings token.
 * 4. LAN enabled + !requireToken — private/LAN clients allowed without a token.
 *
 * /api/health and /api/network (read + unlock paths) are handled carefully so the
 * settings UI and unlock screen can bootstrap.
 */
export function apiAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const path = req.path || ''

  // Always public
  if (path === '/api/health' || path === '/health') {
    return next()
  }

  if (!path.startsWith('/api')) {
    return next()
  }

  // Bootstrap endpoints: allow unauthenticated GET of network status + POST unlock check
  // Actual sensitive mutations still need auth when a token is required.
  const isNetworkStatus = path === '/api/network' && req.method === 'GET'
  const isNetworkUnlock =
    path === '/api/network/unlock' && (req.method === 'POST' || req.method === 'GET')

  const run = async () => {
    const envToken = getEnvAuthToken()
    const settings = await loadNetworkSecurity()
    const remote = req.socket.remoteAddress
    const isLocal = isLoopbackAddress(remote)
    const provided = extractProvidedToken(req)

    // Env token always wins — required from everyone
    if (envToken) {
      if (isNetworkStatus || isNetworkUnlock) {
        // Still allow status without token so unlock UI can load; unlock validates itself
        if (isNetworkUnlock || isNetworkStatus) return next()
      }
      if (provided !== envToken) {
        return res.status(401).json({
          error: 'Unauthorized. Provide Authorization: Bearer <token> or X-API-Token.',
          code: 'AUTH_REQUIRED',
        })
      }
      return next()
    }

    // Loopback clients: always allowed when no env token (this machine)
    if (isLocal) {
      return next()
    }

    // Non-loopback client
    if (!settings.lanAccessEnabled) {
      const { hostLocked } = getListenInfo()
      // When HOST is not locked we rebind to 127.0.0.1 with LAN off, so this is a hard deny.
      // When HOST is locked (Docker sets HOST=0.0.0.0), host port publish is the network boundary —
      // still allow so docker-proxy bridge IPs work. CORS keeps other websites out.
      if (!hostLocked || process.env.STRICT_LOCAL_ONLY === 'true') {
        return res.status(403).json({
          error:
            'Remote API access is disabled. Enable LAN access in Settings → General → Network.',
          code: 'LAN_DISABLED',
        })
      }
      return next()
    }

    // LAN enabled
    if (settings.requireToken) {
      if (isNetworkStatus || isNetworkUnlock) {
        return next()
      }
      const expected = settings.apiAuthToken
      if (!expected) {
        return res.status(503).json({
          error: 'LAN access requires a token but none is configured. Re-enable LAN in Settings.',
          code: 'TOKEN_MISSING',
        })
      }
      if (provided !== expected) {
        return res.status(401).json({
          error: 'LAN access requires the access token from Settings → General.',
          code: 'AUTH_REQUIRED',
        })
      }
    }

    return next()
  }

  run().catch((err) => {
    console.error('[security] auth middleware error:', err)
    res.status(500).json({ error: 'Auth check failed' })
  })
}
