import type { CorsOptions } from 'cors'
import type { NextFunction, Request, Response } from 'express'
import { getClientIp, isLoopbackAddress, isLoopbackHost } from '../utils/path-safety'
import {
  getEnvAuthToken,
  isPrivateNetworkOrigin,
  isPrivateOrLocalHostname,
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
      // Non-browser clients (curl, same-origin no Origin header) have no Origin
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

function isBootstrapPath(path: string, method: string): boolean {
  if (path === '/api/health' || path === '/health') return true
  if (path === '/api/network' && method === 'GET') return true
  if (path === '/api/network/unlock' && (method === 'POST' || method === 'GET')) return true
  return false
}

/**
 * Paths that hold user data / generated artifacts and must follow the same
 * access rules as /api (not world-readable when LAN+token is on).
 */
function isProtectedNonApiPath(path: string): boolean {
  return (
    path === '/uploads' ||
    path.startsWith('/uploads/') ||
    path === '/workspace' ||
    path.startsWith('/workspace/')
  )
}

/**
 * Auth + remote-access guard.
 *
 * Applies to /api/* and sensitive static mounts (/uploads, /workspace).
 * Uses getClientIp() so a reverse proxy on loopback cannot make remote
 * clients appear local (honors X-Forwarded-For from loopback peers).
 *
 * Fail-closed: non-loopback clients are denied when LAN is disabled,
 * even if HOST is locked (Docker). Enable LAN in Settings to allow them.
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

    // True local clients (no forwarded remote IP): allow without settings token
    if (isLocal) {
      return next()
    }

    // Non-loopback client — fail closed when LAN is off.
    // Docker exception: hostLocked + private peer + Host targets loopback.
    // Safe when compose publishes 127.0.0.1:port only (LAN cannot reach the port
    // to spoof Host). If you publish 0.0.0.0:port, enable LAN + token instead.
    if (!settings.lanAccessEnabled) {
      const { hostLocked } = getListenInfo()
      const hostHeader = String(req.headers.host || '').split(':')[0]
      const hostIsLoopback = isLoopbackHost(hostHeader)
      const peerIsPrivate = clientIp ? isPrivateOrLocalHostname(clientIp) : false
      if (hostLocked && peerIsPrivate && hostIsLoopback) {
        return next()
      }
      return res.status(403).json({
        error:
          'Remote API access is disabled. Enable LAN access in Settings → General → Network.',
        code: 'LAN_DISABLED',
      })
    }

    // LAN enabled
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
