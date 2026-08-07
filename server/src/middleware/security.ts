import type { CorsOptions } from 'cors'
import type { NextFunction, Request, Response } from 'express'
import { getClientIp, isLoopbackAddress } from '../utils/path-safety'
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
    'https://localhost:5184',
    'https://127.0.0.1:5184',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'http://localhost:5183',
    'http://127.0.0.1:5183',
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
      if (!origin) {
        callback(null, true)
        return
      }
      if (allowlist.has(origin)) {
        callback(null, true)
        return
      }

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
 * Only health and unlock stay public. Network status is handled by its route
 * with a minimal public payload (no LAN IP leak).
 */
function isBootstrapPath(path: string, method: string): boolean {
  if (path === '/api/health' || path === '/health') return true
  if (path === '/api/network/unlock' && method === 'POST') return true
  // Minimal public network status (route redacts sensitive fields itself)
  if (path === '/api/network' && method === 'GET') return true
  // Auth bootstraps — allow account creation / login without LAN token or prior auth
  if (path === '/api/auth/login' && method === 'POST') return true
  if (path === '/api/auth/register' && method === 'POST') return true
  if (path === '/api/auth/setup-admin' && method === 'POST') return true
  if (path === '/api/auth/setup-status' && method === 'GET') return true
  if (path === '/api/auth/me' && method === 'GET') return true
  if (path === '/api/model-aliases-public' && method === 'GET') return true
  if (path === '/api/settings' && method === 'GET') return true
  return false
}

function isProtectedNonApiPath(path: string): boolean {
  return (
    path === '/uploads' ||
    path.startsWith('/uploads/') ||
    path === '/workspace' ||
    path.startsWith('/workspace/')
  )
}

/**
 * Auth + remote-access guard for /api/* and /uploads|/workspace.
 *
 * Client IP uses getClientIp (rightmost XFF / X-Real-IP only when peer is
 * loopback). Loopback is trusted only when the *resolved* client IP is local —
 * a reverse proxy must overwrite XFF with the real peer (see https-proxy.mjs).
 *
 * When HOST is env-locked (Docker), non-loopback clients always need a token —
 * no Host-header exception.
 */
export function apiAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const path = req.path || ''
  const method = req.method || 'GET'

  if (isBootstrapPath(path, method)) {
    return next()
  }

  const protectApi = path.startsWith('/api')
  const protectStatic = isProtectedNonApiPath(path)
  if (!protectApi && !protectStatic) {
    return next()
  }

  const run = async () => {
    const envToken = getEnvAuthToken()
    const settings = await loadNetworkSecurity()
    const clientIp = getClientIp(req)
    const isLocal = isLoopbackAddress(clientIp)
    const provided = extractProvidedToken(req)
    const { hostLocked } = getListenInfo()

    // Env token always wins — required from everyone (including loopback)
    if (envToken) {
      if (provided !== envToken) {
        return res.status(401).json({
          error: 'Unauthorized. Provide Authorization: Bearer <token> or X-API-Token.',
          code: 'AUTH_REQUIRED',
        })
      }
      return next()
    }

    // True local clients (resolved IP is loopback): allow
    if (isLocal) {
      return next()
    }

    // Non-loopback — fail closed when LAN is off.
    // No Host-header exception (spoofable when the port is published on all interfaces).
    // Docker with ports published as 127.0.0.1:… is protected by the kernel bind;
    // enable LAN (and optionally a token) for container access via the bridge IP.
    if (!settings.lanAccessEnabled) {
      return res.status(403).json({
        error:
          'Remote API access is disabled. Enable LAN access in Settings → General → Network' +
          (hostLocked ? ' (HOST is env-locked / Docker: LAN must be on for non-loopback peers).' : '.'),
        code: 'LAN_DISABLED',
      })
    }

    if (settings.requireToken) {
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
