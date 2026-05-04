import { Router } from 'express'
import { getDb } from '../db'

const router = Router()

const DEFAULT_SHARED_SETTINGS = {
  selectedModel: '',
  selectedProvider: '',
  systemPrompt: 'You are a highly capable AI assistant. You excel at providing helpful, clear, and accurate information. When writing code, always use appropriate markdown formatting and specify the language.\n\nYou have access to tools (like web search). When you need to look up information or use a tool, ALWAYS call the appropriate tool using the proper format. Do not guess information if you can look it up.\n\nCRITICAL CITATION RULE: When providing information from search results or external URLs, you MUST cite your sources inline using the format [source:n], where n is the 1-indexed number of the search result or URL read. This is required for EVERY fact or claim that comes from a tool result.\n\nExample: "The capital of France is Paris [source:1]. The Eiffel Tower was completed in 1889 [source:2]."\n\nFailure to include inline citations is a violation of your instructions.',
  maxTokens: 131072,
  temperature: 0.7,
  topP: 1,
  reasoningEffort: 'auto',
  streamResponses: true,
  showThinking: true,
  showGenerationInfo: true,
  defaultSearchProvider: 'searxng',
  searchConfig: { searxngUrl: 'http://192.168.1.70:8888' },
  artifactsEnabled: true,
  toolDisplayMode: 'individual',
  maxToolTurns: 0,
}

const SYNCABLE_KEYS = new Set(Object.keys(DEFAULT_SHARED_SETTINGS))

function mergeSettings(base: typeof DEFAULT_SHARED_SETTINGS, incoming?: Record<string, unknown>) {
  if (!incoming) return base

  return {
    ...base,
    ...incoming,
    searchConfig: {
      ...base.searchConfig,
      ...(incoming.searchConfig && typeof incoming.searchConfig === 'object' ? incoming.searchConfig as Record<string, string> : {}),
    },
  }
}

async function loadSharedSettings() {
  const db = await getDb()
  const row = await db.get('SELECT value, updated_at FROM app_settings WHERE id = ?', 'global') as any

  if (!row) {
    return { settings: DEFAULT_SHARED_SETTINGS, updatedAt: 0 }
  }

  let parsed: Record<string, unknown> = {}

  try {
    parsed = JSON.parse(row.value || '{}')
  } catch {
    parsed = {}
  }

  return {
    settings: mergeSettings(DEFAULT_SHARED_SETTINGS, parsed),
    updatedAt: row.updated_at || 0,
  }
}

router.get('/', async (_req, res) => {
  res.json(await loadSharedSettings())
})

router.patch('/', async (req, res) => {
  const current = await loadSharedSettings()
  const incoming = Object.fromEntries(
    Object.entries(req.body || {}).filter(([key]) => SYNCABLE_KEYS.has(key))
  )

  const nextSettings = mergeSettings(current.settings, incoming)
  const updatedAt = Date.now()
  const db = await getDb()

  await db.run(
    `INSERT INTO app_settings (id, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    'global',
    JSON.stringify(nextSettings),
    updatedAt
  )

  res.json({ settings: nextSettings, updatedAt })
})

export default router