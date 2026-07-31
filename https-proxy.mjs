/**
 * Optional HTTPS reverse proxy for the AI Chat UI (browser-extension new-tab iframe).
 *
 * SECURITY NOTES
 * --------------
 * - Default listen address is 127.0.0.1 so it is NOT an internet/LAN-facing bypass.
 * - Forwards X-Forwarded-For / X-Real-IP so the app does NOT treat every proxied
 *   request as loopback (the app honors these when the peer is loopback).
 * - Does NOT strip Content-Security-Policy or force X-Frame-Options: ALLOWALL.
 * - Cert is generated for localhost only (no machine-specific LAN IPs committed).
 *
 * Usage:
 *   PROXY_PORT=5184 TARGET_PORT=5183 node https-proxy.mjs
 *
 * To expose on the LAN (not recommended without a token on the app):
 *   PROXY_HOST=0.0.0.0 node https-proxy.mjs
 */
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TARGET_HOST = process.env.TARGET_HOST || '127.0.0.1'
const TARGET_PORT = parseInt(process.env.TARGET_PORT || process.env.PORT || '5183', 10)
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '5184', 10)
// Default loopback only — never open 0.0.0.0 unless explicitly requested
const PROXY_HOST = process.env.PROXY_HOST || '127.0.0.1'
const CERT_DIR = process.env.CERT_DIR || path.join(__dirname, 'certs')

function ensureCert() {
  const keyPath = path.join(CERT_DIR, 'key.pem')
  const certPath = path.join(CERT_DIR, 'cert.pem')

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
  }

  console.log('[https-proxy] Generating self-signed certificate for localhost...')
  fs.mkdirSync(CERT_DIR, { recursive: true })

  // Localhost-only cert — do not bake personal LAN IPs into the repo
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes ` +
      `-subj "/CN=localhost/O=AI-Chat-Proxy/C=US" ` +
      `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
    { stdio: 'pipe' },
  )

  console.log('[https-proxy] Certificate generated at', certPath)
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim()
  }
  return req.socket.remoteAddress || '0.0.0.0'
}

function startProxy() {
  const { key, cert } = ensureCert()

  if (PROXY_HOST === '0.0.0.0' || PROXY_HOST === '::') {
    console.warn(
      '[https-proxy] WARNING: PROXY_HOST binds all interfaces. ' +
        'Proxied clients will be access-controlled via X-Forwarded-For on the app. ' +
        'Enable a LAN token (or API_AUTH_TOKEN) on the app.',
    )
  }

  const server = https.createServer({ key, cert }, (req, res) => {
    const remote = clientIp(req)
    const headers = { ...req.headers }

    // Preserve chain; app uses leftmost hop when peer is loopback
    const prior = typeof headers['x-forwarded-for'] === 'string' ? headers['x-forwarded-for'] : ''
    headers['x-forwarded-for'] = prior ? `${prior}, ${remote}` : remote
    headers['x-real-ip'] = remote
    headers['x-forwarded-proto'] = 'https'
    headers['x-forwarded-host'] = headers.host || `localhost:${PROXY_PORT}`

    // Hop-by-hop
    delete headers['connection']
    delete headers['keep-alive']
    delete headers['proxy-connection']
    delete headers['transfer-encoding']
    delete headers['upgrade']

    const options = {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers,
    }

    const proxyReq = http.request(options, (proxyRes) => {
      // Pass response headers through unchanged — do NOT strip CSP or force ALLOWALL.
      // Extension iframe: load the same-origin HTTPS page, or configure CSP on the app.
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
      proxyRes.pipe(res)
    })

    proxyReq.on('error', (err) => {
      console.error('[https-proxy] Proxy error:', err.message)
      try {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('Bad Gateway: ' + err.message)
      } catch {
        // ignore
      }
    })

    req.pipe(proxyReq)
  })

  server.listen(PROXY_PORT, PROXY_HOST, () => {
    console.log(
      `[https-proxy] Listening on https://${PROXY_HOST}:${PROXY_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`,
    )
  })

  server.on('error', (err) => {
    console.error('[https-proxy] Server error:', err.message)
    process.exit(1)
  })
}

startProxy()
