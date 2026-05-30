import { Router, Request, Response } from 'express'
import { getDb } from '../db'

const router = Router()

/**
 * Proxy to the Hermes Agent API server.
 * Reads the hermes-agent provider config from the DB for auth,
 * so the frontend doesn't need to know the API key.
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

async function proxyRequest(req: Request, res: Response) {
  const config = await getHermesConfig()
  if (!config) {
    return res.status(503).json({ error: 'Hermes Agent provider not configured or disabled' })
  }

  // Strip /api/hermes prefix to get the target path
  const targetPath = req.path.replace(/^\/+/, '')
  const targetUrl = `${config.baseUrl}/${targetPath}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`

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
