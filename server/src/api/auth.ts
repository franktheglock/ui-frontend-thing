import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import { getDb } from '../db'
import { hashPassword, verifyPassword, generateToken, hashToken } from '../utils/password'
import { attachUser, requireAuth, requireAdmin, setAuthCookie, clearAuthCookie } from '../middleware/auth'

const router = Router()

function sanitizeUser(row: any) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || '',
    display_name: row.display_name || '',
    role: row.role,
    status: row.status,
    spendLimit: row.spend_limit ?? 0,
    spend_limit: row.spend_limit ?? 0,
    spendUsed: row.spend_used ?? 0,
    spend_used: row.spend_used ?? 0,
    allowedProviders: row.allowed_providers ? JSON.parse(row.allowed_providers) : null,
    allowed_providers: row.allowed_providers ? JSON.parse(row.allowed_providers) : null,
    createdAt: row.created_at,
    created_at: row.created_at,
    approvedAt: row.approved_at || null,
    approved_at: row.approved_at || null,
    approvedBy: row.approved_by || null,
    approved_by: row.approved_by || null,
    lastLoginAt: row.last_login_at || null,
    last_login_at: row.last_login_at || null,
  }
}

// Public: check if setup is needed (first admin creation)
router.get('/setup-status', async (_req, res) => {
  const db = await getDb()
  const adminCount = await db.get("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND status='approved'") as any
  const userCount = await db.get('SELECT COUNT(*) as c FROM users') as any
  const settingsRow = await db.get('SELECT value FROM app_settings WHERE id = ?', 'global') as any
  let setupComplete = false
  try { if (settingsRow) setupComplete = !!JSON.parse(settingsRow.value || '{}').setupComplete } catch {}
  res.json({
    hasAdmin: (adminCount?.c || 0) > 0,
    hasAnyUser: (userCount?.c || 0) > 0,
    setupComplete,
  })
})

// Admin bootstrap: create first admin via setup wizard (no auth required only when no admin exists)
router.post('/setup-admin', async (req, res) => {
  const { email, password, displayName } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
  const cleanEmail = String(email).trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Invalid email' })
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })

  const db = await getDb()
  const adminCount = await db.get("SELECT COUNT(*) as c FROM users WHERE role='admin' AND status='approved'") as any
  if ((adminCount?.c || 0) > 0) {
    return res.status(400).json({ error: 'Admin already exists. Use login.' })
  }
  // If admin exists but is the seeded one, allow updating? No — use login.
  const existing = await db.get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', cleanEmail) as any
  if (existing) return res.status(400).json({ error: 'Email already in use' })

  const now = Date.now()
  const id = uuidv4()
  const pwHash = await hashPassword(String(password))
  await db.run(
    'INSERT INTO users (id, email, password_hash, display_name, role, status, spend_limit, spend_used, created_at, approved_at, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, cleanEmail, pwHash, displayName ? String(displayName) : 'Admin', 'admin', 'approved', 0, 0, now, now, id
  )

  // Auto-login
  const token = generateToken()
  const tokenHash = hashToken(token)
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
  await db.run('INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', uuidv4(), id, tokenHash, expiresAt, now)
  await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now, id)
  setAuthCookie(res, token)

  const row = await db.get('SELECT * FROM users WHERE id = ?', id) as any
  res.json({ user: sanitizeUser(row), token })
})

router.post('/register', async (req, res) => {
  const { email, password, displayName } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
  const cleanEmail = String(email).trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Invalid email' })
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
  const db = await getDb()
  const existing = await db.get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', cleanEmail) as any
  if (existing) return res.status(409).json({ error: 'Email already registered' })

  const now = Date.now()
  const id = uuidv4()
  const pwHash = await hashPassword(String(password))
  // If this is first user ever, make them admin? But we seed admin, so normally pending.
  // However if no users exist at all (fresh DB without seed race), first registration becomes admin.
  const countRow = await db.get('SELECT COUNT(*) as c FROM users') as any
  const isFirstUser = (countRow?.c || 0) === 0
  const role = isFirstUser ? 'admin' : 'user'
  const status = isFirstUser ? 'approved' : 'pending'

  await db.run(
    'INSERT INTO users (id, email, password_hash, display_name, role, status, spend_limit, spend_used, created_at, approved_at, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, cleanEmail, pwHash, displayName ? String(displayName) : cleanEmail.split('@')[0], role, status, 0, 0, now, status === 'approved' ? now : null, status === 'approved' ? id : null
  )

  if (status === 'approved') {
    const token = generateToken()
    const tokenHash = hashToken(token)
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
    await db.run('INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', uuidv4(), id, tokenHash, expiresAt, now)
    await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now, id)
    setAuthCookie(res, token)
    const row = await db.get('SELECT * FROM users WHERE id = ?', id) as any
    return res.json({ user: sanitizeUser(row), pending: false, token })
  }

  res.status(201).json({ pending: true, message: 'Account created. Awaiting admin approval.' })
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
  const cleanEmail = String(email).trim().toLowerCase()
  const db = await getDb()
  const user = await db.get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', cleanEmail) as any
  if (!user) return res.status(401).json({ error: 'Invalid email or password' })
  const ok = await verifyPassword(String(password), user.password_hash)
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' })

  if (user.status === 'pending') {
    return res.status(403).json({ error: 'Account pending admin approval', code: 'PENDING_APPROVAL' })
  }
  if (user.status === 'rejected') {
    return res.status(403).json({ error: 'Account rejected', code: 'REJECTED' })
  }

  const token = generateToken()
  const tokenHash = hashToken(token)
  const now = Date.now()
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000
  await db.run('INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', uuidv4(), user.id, tokenHash, expiresAt, now)
  await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now, user.id)
  setAuthCookie(res, token)
  const fresh = await db.get('SELECT * FROM users WHERE id = ?', user.id) as any
  res.json({ user: sanitizeUser(fresh), token })
})

router.post('/logout', async (req, res) => {
  const token = (req as any).authToken || (() => {
    const header = req.headers.cookie || ''
    const m = header.match(/auth_token=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  })()
  if (token) {
    const hash = hashToken(token)
    const db = await getDb()
    await db.run('DELETE FROM auth_sessions WHERE token_hash = ?', hash)
  }
  clearAuthCookie(res)
  res.json({ success: true })
})

// Requires auth to check session
router.get('/me', attachUser, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
  const db = await getDb()
  const row = await db.get('SELECT * FROM users WHERE id = ?', req.user.id) as any
  res.json({ user: sanitizeUser(row) })
})

// Admin routes (mounted under /api/auth but also available via /api/admin - we expose both)
router.get('/users', attachUser, requireAdmin, async (_req, res) => {
  const db = await getDb()
  const rows = await db.all('SELECT * FROM users ORDER BY created_at DESC') as any[]
  res.json(rows.map(sanitizeUser))
})

router.patch('/users/:id', attachUser, requireAdmin, async (req, res) => {
  const db = await getDb()
  const target = await db.get('SELECT * FROM users WHERE id = ?', req.params.id) as any
  if (!target) return res.status(404).json({ error: 'User not found' })
  const updates: string[] = []
  const values: any[] = []
  if (req.body.role !== undefined) {
    if (!['admin','user'].includes(req.body.role)) return res.status(400).json({ error: 'Invalid role' })
    updates.push('role = ?')
    values.push(req.body.role)
  }
  if (req.body.status !== undefined) {
    if (!['pending','approved','rejected'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' })
    updates.push('status = ?')
    values.push(req.body.status)
    if (req.body.status === 'approved') {
      updates.push('approved_at = ?')
      values.push(Date.now())
      updates.push('approved_by = ?')
      values.push((req as any).user.id)
    }
  }
  if (req.body.spendLimit !== undefined || req.body.spend_limit !== undefined) {
    const v = req.body.spendLimit ?? req.body.spend_limit
    updates.push('spend_limit = ?')
    values.push(Number(v) || 0)
  }
  if (req.body.allowedProviders !== undefined || req.body.allowed_providers !== undefined) {
    const ap = req.body.allowedProviders ?? req.body.allowed_providers
    updates.push('allowed_providers = ?')
    values.push(ap ? JSON.stringify(ap) : null)
  }
  if (req.body.displayName !== undefined || req.body.display_name !== undefined) {
    const dn = req.body.displayName ?? req.body.display_name
    updates.push('display_name = ?')
    values.push(String(dn || ''))
  }
  if (updates.length === 0) return res.json({ user: sanitizeUser(target) })
  values.push(req.params.id)
  await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values)
  const updated = await db.get('SELECT * FROM users WHERE id = ?', req.params.id) as any
  res.json({ user: sanitizeUser(updated) })
})

router.post('/users/:id/approve', attachUser, requireAdmin, async (req, res) => {
  const db = await getDb()
  const target = await db.get('SELECT * FROM users WHERE id = ?', req.params.id) as any
  if (!target) return res.status(404).json({ error: 'User not found' })
  const spendLimit = req.body?.spendLimit ?? req.body?.spend_limit ?? target.spend_limit
  const allowedProviders = req.body?.allowedProviders ?? req.body?.allowed_providers ?? (target.allowed_providers ? JSON.parse(target.allowed_providers) : null)
  const now = Date.now()
  await db.run(
    'UPDATE users SET status = ?, approved_at = ?, approved_by = ?, spend_limit = ?, allowed_providers = ? WHERE id = ?',
    'approved', now, (req as any).user.id, Number(spendLimit) || 0, allowedProviders ? JSON.stringify(allowedProviders) : null, req.params.id
  )
  const updated = await db.get('SELECT * FROM users WHERE id = ?', req.params.id) as any
  res.json({ user: sanitizeUser(updated) })
})

router.post('/users/:id/reject', attachUser, requireAdmin, async (req, res) => {
  const db = await getDb()
  const target = await db.get('SELECT * FROM users WHERE id = ?', req.params.id) as any
  if (!target) return res.status(404).json({ error: 'User not found' })
  await db.run('UPDATE users SET status = ?, approved_at = NULL, approved_by = NULL WHERE id = ?', 'rejected', req.params.id)
  const updated = await db.get('SELECT * FROM users WHERE id = ?', req.params.id) as any
  res.json({ user: sanitizeUser(updated) })
})

router.delete('/users/:id', attachUser, requireAdmin, async (req, res) => {
  const db = await getDb()
  if (req.params.id === (req as any).user.id) return res.status(400).json({ error: 'Cannot delete yourself' })
  await db.run('DELETE FROM users WHERE id = ?', req.params.id)
  res.json({ success: true })
})

// Admin: usage
router.get('/usage', attachUser, requireAdmin, async (_req, res) => {
  const db = await getDb()
  const rows = await db.all(`
    SELECT u.id, u.email, u.display_name, u.spend_limit, u.spend_used,
           COUNT(ul.id) as request_count,
           COALESCE(SUM(ul.cost), 0) as total_cost
    FROM users u
    LEFT JOIN usage_logs ul ON ul.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `) as any[]
  res.json(rows)
})

// Admin: per-user usage logs
router.get('/users/:id/usage', attachUser, requireAdmin, async (req, res) => {
  const db = await getDb()
  const rows = await db.all('SELECT * FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', req.params.id) as any[]
  res.json(rows)
})

export default router
