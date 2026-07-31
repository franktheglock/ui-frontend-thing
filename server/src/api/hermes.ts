import { Router, Request, Response } from 'express'
import { getDb } from '../db'
import { isLoopbackHost } from '../utils/path-safety'

const router = Router()

/**
 * Proxy to the Hermes Agent API server.
 * Reads the hermes-agent provider config from the DB for auth,
 * so the frontend doesn't need to know the API key.
 *
 * Security: only proxies to loopback hosts by default so this never becomes
 * an open credential-attaching reverse proxy to an attacker-controlled base URL.
 * Set HERMES_ALLOW_REMOTE=true to allow non-loopback base URLs (use with care).
 */

async function getHermesConfig(): Promise<{ baseUrl: string; apiKey: string | null } | null> {
  try {
    const db = await getDb()
    const provider = await db.get(
      'SELECT base_url, api_key FROM providers WHERE id = ? AND enabled = 1',
      'hermes-agent'
    ) as any
    if (!provider) return null
    return {
      baseUrl: (provider.base_url || 'http://localhost:8642').replace(/\/+$/, ''),
      apiKey: provider.api_key || null,
    }
  } catch {
    return null
  }
}

function assertSafeHermesTarget(baseUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return 'Hermes base URL is invalid'
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Hermes base URL must be http or https'
  }

  const allowRemote = process.env.HERMES_ALLOW_REMOTE === 'true'
  if (!allowRemote && !isLoopbackHost(parsed.hostname)) {
    return (
      `Hermes proxy refuses non-loopback host "${parsed.hostname}". ` +
      `Point hermes-agent at localhost, or set HERMES_ALLOW_REMOTE=true if you intentionally proxy remotely.`
    )
  }

  return null
}

async function proxyRequest(req: Request, res: Response) {
  const config = await getHermesConfig()
  if (!config) {
    return res.status(503).json({ error: 'Hermes Agent provider not configured or disabled' })
  }

  const targetError = assertSafeHermesTarget(config.baseUrl)
  if (targetError) {
    return res.status(403).json({ error: targetError })
  }

  // Strip /api/hermes prefix to get the target path
  const targetPath = req.path.replace(/^\/+/, '')
  // Prevent open-proxy path tricks (absolute URL in path, scheme-relative, etc.)
  if (
    targetPath.includes('://') ||
    targetPath.startsWith('//') ||
    targetPath.includes('\\')
  ) {
    return res.status(400).json({ error: 'Invalid Hermes proxy path' })
  }

  const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
  const targetUrl = `${config.baseUrl}/${targetPath}${query}`

  // Final check: resolved URL host must still match configured host
  try {
    const resolved = new URL(targetUrl)
    const expected = new URL(config.baseUrl)
    if (resolved.origin !== expected.origin) {
      return res.status(400).json({ error: 'Hermes proxy refused cross-origin redirect target' })
    }
  } catch {
    return res.status(400).json({ error: 'Invalid Hermes target URL' })
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`
    }

    const proxyRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      redirect: 'manual',
    })

    // For SSE endpoints (runs/events), pipe the stream through
    const contentType = proxyRes.headers.get('content-type') || ''
    if (contentType.includes('text/event-stream') || targetPath.includes('/events')) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      const reader = proxyRes.body?.getReader()
      if (!reader) {
        return res.status(502).json({ error: 'No response body from Hermes' })
      }
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(decoder.decode(value, { stream: true }))
      }
      res.end()
      return
    }

    const body = await proxyRes.text()
    res.status(proxyRes.status).set('Content-Type', contentType).send(body)
  } catch (err: any) {
    console.error('[hermes] Proxy error:', err.message)
    const isConnRefused = err.message?.includes('fetch failed') || err.message?.includes('ECONNREFUSED') || err.message?.includes('connect')
    const message = isConnRefused
      ? 'Hermes Agent gateway is not running. Start it with `hermes gateway`.'
      : `Hermes Agent proxy error: ${err.message}`
    res.status(502).json({ error: message })
  }
}

// All methods and paths under /api/hermes
router.all('*', async (req, res) => {
  await proxyRequest(req, res)
})

export default router
