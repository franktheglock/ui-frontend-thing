import crypto from 'crypto'
import os from 'os'
import { getDb } from './db'

export interface NetworkSecuritySettings {
  /** Allow browsers / clients on the LAN (and similar private nets) to use the API. */
  lanAccessEnabled: boolean
  /**
   * When LAN is on, require a shared access token for non-loopback clients.
   * Loopback (this machine) never needs the token unless env API_AUTH_TOKEN is set.
   */
  requireToken: boolean
  /** Shared secret. Empty means none configured. */
  apiAuthToken: string
}

const SETTINGS_ID = 'network_security'

const DEFAULTS: NetworkSecuritySettings = {
  lanAccessEnabled: false,
  requireToken: true,
  apiAuthToken: '',
}

let cache: NetworkSecuritySettings | null = null

function generateToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

export async function loadNetworkSecurity(): Promise<NetworkSecuritySettings> {
  if (cache) return { ...cache }

  const db = await getDb()
  const row = (await db.get(
    'SELECT value FROM app_settings WHERE id = ?',
    SETTINGS_ID,
  )) as { value?: string } | undefined

  if (!row?.value) {
    cache = { ...DEFAULTS }
    return { ...cache }
  }

  try {
    const parsed = JSON.parse(row.value) as Partial<NetworkSecuritySettings>
    cache = {
      lanAccessEnabled: !!parsed.lanAccessEnabled,
      requireToken: parsed.requireToken !== false,
      apiAuthToken: typeof parsed.apiAuthToken === 'string' ? parsed.apiAuthToken : '',
    }
  } catch {
    cache = { ...DEFAULTS }
  }

  return { ...cache }
}

export async function saveNetworkSecurity(
  updates: Partial<NetworkSecuritySettings> & { regenerateToken?: boolean },
): Promise<NetworkSecuritySettings> {
  const current = await loadNetworkSecurity()
  const next: NetworkSecuritySettings = {
    lanAccessEnabled:
      updates.lanAccessEnabled !== undefined
        ? !!updates.lanAccessEnabled
        : current.lanAccessEnabled,
    requireToken:
      updates.requireToken !== undefined ? !!updates.requireToken : current.requireToken,
    apiAuthToken: current.apiAuthToken,
  }

  if (updates.regenerateToken) {
    next.apiAuthToken = generateToken()
  } else if (typeof updates.apiAuthToken === 'string') {
    next.apiAuthToken = updates.apiAuthToken.trim()
  }

  // When enabling LAN with token required and no token yet, mint one
  if (next.lanAccessEnabled && next.requireToken && !next.apiAuthToken) {
    next.apiAuthToken = generateToken()
  }

  // Turning LAN off doesn't wipe the token (so re-enable is easy)
  const db = await getDb()
  await db.run(
    `INSERT INTO app_settings (id, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    SETTINGS_ID,
    JSON.stringify(next),
    Date.now(),
  )

  cache = next
  return { ...next }
}

/** Effective token: env overrides DB. */
export function getEnvAuthToken(): string {
  return (process.env.API_AUTH_TOKEN || process.env.AUTH_TOKEN || '').trim()
}

export async function getEffectiveAuthToken(): Promise<string> {
  const env = getEnvAuthToken()
  if (env) return env
  const settings = await loadNetworkSecurity()
  return settings.apiAuthToken || ''
}

/**
 * Private / local hostnames safe to allow when LAN access is enabled.
 * Includes RFC1918, link-local, CGNAT, .local mDNS, and Tailscale CGNAT 100.64/10.
 */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1') return true
  if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home')) return true

  // IPv4
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 10) return true
    if (a === 127) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
    // Tailscale / carrier-grade NAT
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }

  // Basic IPv6 ULA / link-local
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true

  return false
}

export function isPrivateNetworkOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return isPrivateOrLocalHostname(u.hostname)
  } catch {
    return false
  }
}

/** Collect likely LAN URLs for display in settings. */
export function collectLanHints(port: number): string[] {
  const urls: string[] = []
  const ifaces = os.networkInterfaces()
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.internal) continue
      // Node types: family can be 'IPv4' | 'IPv6' or 4 | 6 depending on version
      const family = String(entry.family)
      if (family !== 'IPv4' && family !== '4') continue
      if (!isPrivateOrLocalHostname(entry.address)) continue
      urls.push(`http://${entry.address}:${port}`)
    }
  }
  return [...new Set(urls)].slice(0, 8)
}
