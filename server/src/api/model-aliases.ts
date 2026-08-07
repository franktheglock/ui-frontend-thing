import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import { attachUser, requireAdmin } from '../middleware/auth'

const router = Router()

// All routes require admin
router.use(attachUser, requireAdmin)

// GET /api/model-aliases  -> list (also public filtered list available without auth? but we handle there too)
router.get('/', async (_req, res) => {
  const db = await getDb()
  const rows = await db.all('SELECT * FROM model_aliases ORDER BY display_name') as any[]
  res.json(rows.map((r: any) => ({
    id: r.id,
    displayName: r.display_name,
    display_name: r.display_name,
    providerId: r.provider_id,
    provider_id: r.provider_id,
    model: r.model,
    description: r.description || '',
    enabled: !!r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })))
})

router.post('/', async (req, res) => {
  const { displayName, display_name, providerId, provider_id, model, description, enabled } = req.body || {}
  const dn = String(displayName || display_name || '').trim()
  const pid = String(providerId || provider_id || '').trim()
  const m = String(model || '').trim()
  if (!dn || !pid || !m) return res.status(400).json({ error: 'displayName, providerId, and model are required' })
  const db = await getDb()
  const exists = await db.get('SELECT * FROM model_aliases WHERE display_name = ? COLLATE NOCASE', dn) as any
  if (exists) return res.status(409).json({ error: 'Alias name already exists' })
  const now = Date.now()
  const id = uuidv4()
  await db.run(
    'INSERT INTO model_aliases (id, display_name, provider_id, model, description, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, dn, pid, m, description ? String(description) : '', enabled === false ? 0 : 1, now, now
  )
  const row = await db.get('SELECT * FROM model_aliases WHERE id = ?', id) as any
  res.json({
    id: row.id,
    displayName: row.display_name,
    display_name: row.display_name,
    providerId: row.provider_id,
    provider_id: row.provider_id,
    model: row.model,
    description: row.description || '',
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
})

router.patch('/:id', async (req, res) => {
  const db = await getDb()
  const cur = await db.get('SELECT * FROM model_aliases WHERE id = ?', req.params.id) as any
  if (!cur) return res.status(404).json({ error: 'Alias not found' })
  const dn = req.body.displayName !== undefined || req.body.display_name !== undefined ? String(req.body.displayName ?? req.body.display_name).trim() : cur.display_name
  const pid = req.body.providerId !== undefined || req.body.provider_id !== undefined ? String(req.body.providerId ?? req.body.provider_id).trim() : cur.provider_id
  const m = req.body.model !== undefined ? String(req.body.model).trim() : cur.model
  const desc = req.body.description !== undefined ? String(req.body.description) : cur.description
  const enabled = req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : cur.enabled
  if (!dn || !pid || !m) return res.status(400).json({ error: 'displayName, providerId, model required' })
  // check uniqueness if changed
  if (dn.toLowerCase() !== cur.display_name.toLowerCase()) {
    const dup = await db.get('SELECT * FROM model_aliases WHERE display_name = ? COLLATE NOCASE AND id != ?', dn, req.params.id) as any
    if (dup) return res.status(409).json({ error: 'Alias name already exists' })
  }
  const now = Date.now()
  await db.run('UPDATE model_aliases SET display_name = ?, provider_id = ?, model = ?, description = ?, enabled = ?, updated_at = ? WHERE id = ?', dn, pid, m, desc || '', enabled, now, req.params.id)
  const row = await db.get('SELECT * FROM model_aliases WHERE id = ?', req.params.id) as any
  res.json({
    id: row.id,
    displayName: row.display_name,
    display_name: row.display_name,
    providerId: row.provider_id,
    provider_id: row.provider_id,
    model: row.model,
    description: row.description || '',
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
})

router.delete('/:id', async (req, res) => {
  const db = await getDb()
  await db.run('DELETE FROM model_aliases WHERE id = ?', req.params.id)
  res.json({ success: true })
})

export default router

// Public router for non-admin: list enabled aliases
export async function listEnabledAliases() {
  const db = await getDb()
  const rows = await db.all('SELECT * FROM model_aliases WHERE enabled = 1 ORDER BY display_name') as any[]
  return rows.map((r: any) => ({
    id: r.id,
    displayName: r.display_name,
    display_name: r.display_name,
    providerId: r.provider_id,
    provider_id: r.provider_id,
    model: r.model,
    description: r.description || '',
    enabled: !!r.enabled,
  }))
}
