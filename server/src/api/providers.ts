import { Router } from 'express'
import { getDb } from '../db'
import { createProviderFromConfig, getProvider } from '../providers'
import { requireAdmin } from '../middleware/auth'
import { resolveApiKeyUpdate, sanitizeProvider } from '../utils/providers'

const router = Router()

const DEFAULT_PROVIDER_IDS = new Set([
  'openai',
  'anthropic',
  'ollama',
  'gemini',
  'openrouter',
  'lmstudio',
  'llamacpp',
  'nvidia',
  'opencode-go',
  'openai-compatible',
  'hermes-agent',
])

router.get('/', async (req: any, res) => {
  const db = await getDb()
  const providers = await db.all('SELECT * FROM providers')
  // Filter by allowed_providers for non-admin & handle simplified alias mode
  let filtered = providers.map((p: any) => sanitizeProvider(p))
  try {
    const user: any = (req as any).user
    if (user && user.role !== 'admin') {
      const allowed: string[] | null = user.allowed_providers
      if (Array.isArray(allowed) && allowed.length > 0) {
        filtered = filtered.filter((pr: any) => allowed.includes(pr.id))
      }
    }
    // If simplified picker enabled, hide raw providers unless admin explicitly wants them
    const row = await db.get('SELECT value FROM app_settings WHERE id = ?', 'global') as any
    const settings = row?.value ? JSON.parse(row.value) : {}
    if (settings.useSimplifiedPicker && user?.role !== 'admin') {
      // keep providers but frontend will prefer aliases; do not hide completely
    }
  } catch {}
  res.json(filtered)
})

router.post('/', async (req: any, res) => {
  // Only admin can create providers
  if ((req as any).user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const db = await getDb()
  const { id, name, type, baseUrl, apiKey, models, enabled, config } = req.body
  await db.run(
    'INSERT INTO providers (id, name, type, base_url, api_key, models, enabled, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, name, type, baseUrl || null, apiKey || null, JSON.stringify(models || []), enabled ? 1 : 0, config ? JSON.stringify(config) : null
  )
  await db.run('DELETE FROM deleted_default_providers WHERE id = ?', id)

  // Auto-fetch models from the provider
  let fetchedModels = models || []
  try {
    const providerInstance = createProviderFromConfig({ type, baseUrl, apiKey })
    if (providerInstance && 'fetchModels' in providerInstance && typeof (providerInstance as any).fetchModels === 'function') {
      const remoteModels = await (providerInstance as any).fetchModels()
      if (remoteModels && remoteModels.length > 0) {
        fetchedModels = remoteModels
        await db.run('UPDATE providers SET models = ? WHERE id = ?', JSON.stringify(remoteModels), id)
      }
    }
  } catch (err: any) {
    console.error(`[providers] Failed to auto-fetch models for ${id}:`, err.message)
  }

  const row = await db.get('SELECT * FROM providers WHERE id = ?', id) as any
  res.json(sanitizeProvider(row || {
    id, name, type, base_url: baseUrl, api_key: apiKey, models: JSON.stringify(fetchedModels), enabled, config: config ? JSON.stringify(config) : null,
  }))
})

router.patch('/:id', async (req: any, res) => {
  if ((req as any).user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const db = await getDb()
  // Get current provider values to allow partial updates
  const current = await db.get('SELECT * FROM providers WHERE id = ?', req.params.id) as any
  if (!current) return res.status(404).json({ error: 'Provider not found' })

  const name = req.body.name !== undefined ? req.body.name : current.name
  const baseUrl = req.body.baseUrl !== undefined ? req.body.baseUrl : current.base_url
  // Empty string must NOT wipe an existing key (frontend often re-sends redacted/empty values)
  const apiKey = resolveApiKeyUpdate(req.body, current.api_key)
  const models = req.body.models !== undefined ? req.body.models : (JSON.parse(current.models || '[]'))
  const enabled = req.body.enabled !== undefined ? req.body.enabled : !!current.enabled
  const config = req.body.config !== undefined ? req.body.config : (current.config ? JSON.parse(current.config) : {})

  await db.run(
    'UPDATE providers SET name = ?, base_url = ?, api_key = ?, models = ?, enabled = ?, config = ? WHERE id = ?',
    name, baseUrl || null, apiKey || null, JSON.stringify(models || []), enabled ? 1 : 0, config ? JSON.stringify(config) : null, req.params.id
  )
  await db.run('DELETE FROM deleted_default_providers WHERE id = ?', req.params.id)

  // Auto-fetch models from the provider
  try {
    const provider = await db.get('SELECT * FROM providers WHERE id = ?', req.params.id) as any
    if (provider) {
      const providerInstance = createProviderFromConfig(provider)
      if (providerInstance && 'fetchModels' in providerInstance && typeof (providerInstance as any).fetchModels === 'function') {
        const remoteModels = await (providerInstance as any).fetchModels()
        if (remoteModels && remoteModels.length > 0) {
          await db.run('UPDATE providers SET models = ? WHERE id = ?', JSON.stringify(remoteModels), req.params.id)
        }
      }
    }
  } catch (err: any) {
    console.error(`[providers] Failed to auto-fetch models for ${req.params.id}:`, err.message)
  }

  const updated = await db.get('SELECT * FROM providers WHERE id = ?', req.params.id) as any
  res.json({ success: true, provider: sanitizeProvider(updated) })
})

router.delete('/:id', async (req: any, res) => {
  if ((req as any).user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const db = await getDb()
  await db.run('DELETE FROM providers WHERE id = ?', req.params.id)

  if (DEFAULT_PROVIDER_IDS.has(req.params.id)) {
    await db.run(
      `INSERT INTO deleted_default_providers (id, deleted_at)
       VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at`,
      req.params.id,
      Date.now()
    )
  }

  res.json({ success: true })
})

router.get('/:id/models', async (req, res) => {
  const db = await getDb()
  const provider = await db.get('SELECT * FROM providers WHERE id = ?', req.params.id) as any
  if (!provider) return res.status(404).json({ error: 'Provider not found' })

  const fallbackModels = JSON.parse(provider.models || '[]')

  try {
    const providerInstance = await getProvider(req.params.id)
    if (!providerInstance) {
      return res.json(fallbackModels)
    }

    // Check if provider has fetchModels method
    if ('fetchModels' in providerInstance && typeof (providerInstance as any).fetchModels === 'function') {
      const models = await (providerInstance as any).fetchModels()
      if (models && models.length > 0) {
        // Update cached models in DB
        await db.run('UPDATE providers SET models = ? WHERE id = ?', JSON.stringify(models), req.params.id)
        return res.json(models)
      }
    }
  } catch (err: any) {
    console.error(`[providers] Failed to fetch models for ${provider.id}:`, err.message)
  }

  res.json(fallbackModels)
})

router.post('/probe-models', async (req, res) => {
  const { type, baseUrl, apiKey } = req.body || {}

  if (!type) {
    return res.status(400).json({ error: 'Provider type is required' })
  }

  try {
    const providerInstance = createProviderFromConfig({
      type,
      baseUrl,
      apiKey,
    })

    if (!providerInstance || !("fetchModels" in providerInstance) || typeof (providerInstance as any).fetchModels !== 'function') {
      return res.status(400).json({ error: 'This provider type does not support model probing' })
    }

    const models = await (providerInstance as any).fetchModels()
    return res.json({ models: models || [] })
  } catch (err: any) {
    console.error('[providers] Probe failed:', err.message)
    return res.status(500).json({ error: err.message || 'Failed to probe models' })
  }
})

export default router
