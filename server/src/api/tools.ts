import { Router } from 'express'
import { getDb } from '../db'
import { listTools } from '../tools'

const router = Router()

router.get('/', (_req, res) => {
  const tools = listTools()
  res.json(tools)
})

router.get('/db', async (_req, res) => {
  const db = await getDb()
  const tools = await db.all('SELECT * FROM tools')
  res.json(tools.map((t: any) => ({
    ...t,
    schema: JSON.parse(t.schema),
    enabled: !!t.enabled,
    config: t.config ? JSON.parse(t.config) : undefined,
  })))
})

router.post('/', async (req, res) => {
  const db = await getDb()
  const { id, name, description, schema, enabled, config } = req.body
  await db.run(
    'INSERT INTO tools (id, name, description, schema, enabled, config) VALUES (?, ?, ?, ?, ?, ?)',
    id, name, description, JSON.stringify(schema), enabled ? 1 : 0, config ? JSON.stringify(config) : null
  )
  res.json({ id, name, description, schema, enabled, config })
})

router.patch('/:id', async (req, res) => {
  const db = await getDb()
  const { enabled, config } = req.body
  await db.run(
    'UPDATE tools SET enabled = ?, config = ? WHERE id = ?',
    enabled ? 1 : 0, config ? JSON.stringify(config) : null, req.params.id
  )
  res.json({ success: true })
})

router.delete('/:id', async (req, res) => {
  const db = await getDb()
  await db.run('DELETE FROM tools WHERE id = ?', req.params.id)
  res.json({ success: true })
})

export default router
