import { Router } from 'express'
import { getDb } from '../db'
import { ensureMemoryFile, readMemory, replaceMemory } from '../memory'

const router = Router()

async function getMemoryEnabled() {
  const db = await getDb()
  const row = await db.get('SELECT value FROM app_settings WHERE id = ?', 'global') as any
  if (!row?.value) return true
  try {
    const settings = JSON.parse(row.value || '{}')
    return settings.memoryEnabled !== false
  } catch {
    return true
  }
}

router.get('/', async (_req, res) => {
  const filePath = ensureMemoryFile()
  res.json({
    enabled: await getMemoryEnabled(),
    filePath,
    content: readMemory(),
  })
})

router.put('/', async (req, res) => {
  const content = String(req.body?.content || '')
  const result = replaceMemory(content)
  res.json({
    enabled: await getMemoryEnabled(),
    filePath: result.filePath,
    content: result.content,
  })
})

export default router
