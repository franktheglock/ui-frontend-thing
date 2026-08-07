import type { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { getDb } from '../db'
import { hashToken } from '../utils/password'

export interface AuthUser {
  id: string
  email: string
  display_name?: string
  role: 'admin' | 'user'
  status: 'pending' | 'approved' | 'rejected'
  spend_limit: number
  spend_used: number
  allowed_providers: string[] | null
  created_at: number
  approved_at?: number
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      authToken?: string
    }
  }
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  header.split(';').forEach(part => {
    const idx = part.indexOf('=')
    if (idx < 0) return
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  })
  return out
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const cookies = parseCookies(req.headers.cookie as string | undefined)
    let token = cookies['auth_token']
    // also allow Authorization Bearer for API clients / extension
    if (!token) {
      const auth = req.headers.authorization
      if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
        token = auth.slice(7).trim()
      }
    }
    if (!token) return next()

    const tokenHash = hashToken(token)
    const db = await getDb()
    const sess = await db.get('SELECT * FROM auth_sessions WHERE token_hash = ? AND expires_at > ?', tokenHash, Date.now()) as any
    if (!sess) return next()

    const user = await db.get('SELECT * FROM users WHERE id = ?', sess.user_id) as any
    if (!user || user.status !== 'approved') return next()

    req.user = {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      role: user.role,
      status: user.status,
      spend_limit: user.spend_limit || 0,
      spend_used: user.spend_used || 0,
      allowed_providers: user.allowed_providers ? JSON.parse(user.allowed_providers) : null,
      created_at: user.created_at,
      approved_at: user.approved_at,
    }
    req.authToken = token
    next()
  } catch (err) {
    console.error('[auth] attachUser error', err)
    next()
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' })
  }
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' })
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only', code: 'FORBIDDEN' })
  }
  next()
}

export function setAuthCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === 'production'
  // 30 days
  const maxAge = 30 * 24 * 60 * 60
  const parts = [
    `auth_token=${encodeURIComponent(token)}`,
    `Path=/`,
    `HttpOnly`,
    `Max-Age=${maxAge}`,
    `SameSite=Lax`,
  ]
  if (isProd) parts.push('Secure')
  // Express res.append handles multiple Set-Cookie
  res.append('Set-Cookie', parts.join('; '))
}

export function clearAuthCookie(res: Response) {
  res.append('Set-Cookie', 'auth_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax')
}
