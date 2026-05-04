import { Router } from 'express'
import { getDb } from '../db'
import { listTools } from '../tools'

const router = Router()

router.get('/', async (_req, res) => {
  const db = await getDb()
  const tools = listTools()
  const savedTools = await db.all('SELECT * FROM tools')
  const savedById = new Map(savedTools.map((tool: any) => [tool.id, tool]))

  res.json(tools.map((tool: any) => {
    const saved = savedById.get(tool.name) || savedById.get(tool.id)

    return {
      ...tool,
      enabled: saved ? !!saved.enabled : true,
      config: saved?.config ? JSON.parse(saved.config) : {},
    }
  }))
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
  const tool = listTools().find((candidate: any) => candidate.name === req.params.id || candidate.id === req.params.id)

  if (!tool) {
    return res.status(404).json({ error: 'Tool not found' })
  }

  await db.run(
    `INSERT INTO tools (id, name, description, schema, enabled, config)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, config = excluded.config`,
    req.params.id,
    tool.name,
    tool.description || null,
    JSON.stringify(tool.parameters || {}),
    enabled ? 1 : 0,
    config ? JSON.stringify(config) : null
  )

  res.json({ success: true })
})

router.delete('/:id', async (req, res) => {
  const db = await getDb()
  await db.run('DELETE FROM tools WHERE id = ?', req.params.id)
  res.json({ success: true })
})

export default router
