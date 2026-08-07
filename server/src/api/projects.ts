import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'

const router = Router()
import { requireAuth } from "../middleware/auth";
router.use(requireAuth as any);
function getUserId(req: any): string { return req.user?.id as string; }

function mapProject(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    memory: row.memory || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    chatCount: row.chat_count || 0,
    fileCount: row.file_count || 0,
  }
}

function mapProjectFile(row: any) {
  return {
    projectId: row.project_id,
    url: row.file_url,
    name: row.name,
    mimeType: row.mime_type || 'application/octet-stream',
    createdAt: row.created_at,
  }
}

router.get('/', async (req: any, res) => {
  const db = await getDb()
  const userId = getUserId(req)
  const rows = await db.all(`
    SELECT
      p.*,
      COUNT(DISTINCT s.id) AS chat_count,
      COUNT(DISTINCT pf.file_url) AS file_count
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id AND s.user_id = p.user_id
    LEFT JOIN project_files pf ON pf.project_id = p.id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `, userId)
  res.json(rows.map(mapProject))
})

router.post('/', async (req, res) => {
  const db = await getDb()
  const id = req.body.id || uuidv4()
  const name = String(req.body.name || 'New Project').trim() || 'New Project'
  const description = req.body.description ? String(req.body.description) : null
  const memory = req.body.memory ? String(req.body.memory) : ''
  const now = Date.now()

  const userId = getUserId(req)
  await db.run(
    'INSERT INTO projects (id, name, description, memory, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    name,
    description,
    memory,
    now,
    now,
    userId
  )

  res.json({
    id,
    name,
    description: description || '',
    memory,
    createdAt: now,
    updatedAt: now,
    chatCount: 0,
    fileCount: 0,
  })
})

router.get('/:id', async (req: any, res) => {
  const db = await getDb()
  const userId = getUserId(req)
  const row = await db.get(`
    SELECT
      p.*,
      COUNT(DISTINCT s.id) AS chat_count,
      COUNT(DISTINCT pf.file_url) AS file_count
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    LEFT JOIN project_files pf ON pf.project_id = p.id
    WHERE p.id = ? AND p.user_id = ?
    GROUP BY p.id
  `, req.params.id, userId)

  if (!row) return res.status(404).json({ error: 'Project not found' })
  res.json(mapProject(row))
})

router.patch('/:id', async (req: any, res) => {
  const db = await getDb()
  const userId = getUserId(req)
  const owned = await db.get('SELECT id FROM projects WHERE id = ? AND user_id = ?', req.params.id, userId) as any;
  if (!owned) return res.status(404).json({ error: 'Project not found' })
  const updates: string[] = []
  const values: any[] = []

  if (req.body.name !== undefined) {
    const name = String(req.body.name || '').trim()
    if (!name) return res.status(400).json({ error: 'Project name is required' })
    updates.push('name = ?')
    values.push(name)
  }
  if (req.body.description !== undefined) {
    updates.push('description = ?')
    values.push(String(req.body.description || ''))
  }
  if (req.body.memory !== undefined) {
    updates.push('memory = ?')
    values.push(String(req.body.memory || ''))
  }

  if (updates.length === 0) return res.json({ success: true })
  updates.push('updated_at = ?')
  values.push(Date.now())
  values.push(req.params.id)

  await db.run(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, values)
  res.json({ success: true })
})

router.delete('/:id', async (req: any, res) => {
  const db = await getDb()
  const userId = getUserId(req)
  const owned2 = await db.get('SELECT id FROM projects WHERE id = ? AND user_id = ?', req.params.id, userId) as any;
  if (!owned2) return res.status(404).json({ error: 'Project not found' })
  await db.run('UPDATE sessions SET project_id = NULL, updated_at = ? WHERE project_id = ? AND user_id = ?', Date.now(), req.params.id, userId)
  await db.run('DELETE FROM projects WHERE id = ?', req.params.id)
  res.json({ success: true })
})

router.get('/:id/files', async (req: any, res) => {
  const db = await getDb()
  const userId = getUserId(req)
  const ownF = await db.get('SELECT id FROM projects WHERE id = ? AND user_id = ?', req.params.id, userId) as any;
  if (!ownF) return res.status(404).json({ error: 'Project not found' })
  const rows = await db.all(
    'SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at DESC',
    req.params.id,
  )
  res.json(rows.map(mapProjectFile))
})

router.post('/:id/files', async (req: any, res) => {
  const db = await getDb()
  const userId = getUserId(req)
  const ownF2 = await db.get('SELECT id FROM projects WHERE id = ? AND user_id = ?', req.params.id, userId) as any;
  if (!ownF2) return res.status(404).json({ error: 'Project not found' })
  const files = Array.isArray(req.body.files) ? req.body.files : [req.body]
  const now = Date.now()

  for (const file of files) {
    const url = String(file.url || file.path || '').trim()
    if (!url) continue
    await db.run(
      `INSERT OR REPLACE INTO project_files (project_id, file_url, name, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      req.params.id,
      url,
      String(file.name || url.split('/').pop() || 'file'),
      file.mimeType ? String(file.mimeType) : null,
      now,
    )
  }

  await db.run('UPDATE projects SET updated_at = ? WHERE id = ?', now, req.params.id)
  const rows = await db.all(
    'SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at DESC',
    req.params.id,
  )
  res.json(rows.map(mapProjectFile))
})

router.delete('/:id/files', async (req, res) => {
  const db = await getDb()
  const url = String(req.body.url || '').trim()
  if (!url) return res.status(400).json({ error: 'url is required' })
  await db.run('DELETE FROM project_files WHERE project_id = ? AND file_url = ?', req.params.id, url)
  await db.run('UPDATE projects SET updated_at = ? WHERE id = ?', Date.now(), req.params.id)
  res.json({ success: true })
})

export default router
