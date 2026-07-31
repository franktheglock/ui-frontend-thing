/**
 * Sanitize a provider row for API responses — never expose raw API keys.
 */
export function sanitizeProvider(row: any) {
  const hasApiKey = !!(row.api_key && String(row.api_key).trim())
  let models: string[] = []
  try {
    models = JSON.parse(row.models || '[]')
  } catch {
    models = []
  }
  let config: Record<string, unknown> | undefined
  try {
    config = row.config ? JSON.parse(row.config) : undefined
  } catch {
    config = undefined
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url ?? row.baseUrl ?? null,
    // Never return the real key. Clients send a new value only when updating.
    apiKey: '',
    hasApiKey,
    models,
    enabled: !!row.enabled,
    config,
  }
}

/**
 * Resolve api_key for a PATCH/POST update.
 * - undefined / empty string → keep existing (do not wipe)
 * - null with clearApiKey → clear
 * - non-empty string → set
 */
export function resolveApiKeyUpdate(
  body: { apiKey?: string | null; clearApiKey?: boolean },
  currentKey: string | null | undefined,
): string | null {
  if (body.clearApiKey === true || body.apiKey === null) {
    return null
  }
  if (typeof body.apiKey === 'string' && body.apiKey.trim() !== '') {
    return body.apiKey
  }
  return currentKey ?? null
}
