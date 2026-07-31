/**
 * Optional HTTPS reverse proxy for the AI Chat UI (browser-extension new-tab iframe).
 *
 * SECURITY NOTES
 * --------------
 * - Default listen address is 127.0.0.1 (not LAN/internet-facing).
 * - ALWAYS overwrites X-Forwarded-For / X-Real-IP with req.socket.remoteAddress.
 *   Never reads or appends the client's X-Forwarded-For (that value is untrusted).
 * - The app trusts only the rightmost XFF hop / X-Real-IP when the TCP peer is
 *   loopback — so a spoofed left hop cannot become "local".
 * - Does NOT strip Content-Security-Policy or force framing headers.
 * - Cert is localhost-only.
 *
 * Usage:
 *   PROXY_PORT=5184 TARGET_PORT=5183 node https-proxy.mjs
 *
 * Exposing on the LAN requires PROXY_HOST=0.0.0.0 AND a token on the app
 * (Settings LAN token or API_AUTH_TOKEN). Prefer not to.
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

  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes ` +
      `-subj "/CN=localhost/O=AI-Chat-Proxy/C=US" ` +
      `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
    { stdio: 'pipe' },
  )

  console.log('[https-proxy] Certificate generated at', certPath)
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
}

/** Only the TCP peer — never client-asserted X-Forwarded-For. */
function tcpPeerIp(req) {
  const addr = req.socket.remoteAddress || '0.0.0.0'
  // Normalize IPv4-mapped IPv6
  if (addr.startsWith('::ffff:')) return addr.slice(7)
  return addr
}

function startProxy() {
  const { key, cert } = ensureCert()

  if (PROXY_HOST === '0.0.0.0' || PROXY_HOST === '::') {
    console.warn(
      '[https-proxy] WARNING: PROXY_HOST binds all interfaces. ' +
        'The app will see real client IPs via X-Real-IP (overwritten here). ' +
        'You MUST enable a LAN access token or API_AUTH_TOKEN on the app.',
    )
  }

  const server = https.createServer({ key, cert }, (req, res) => {
    const peer = tcpPeerIp(req)
    const headers = { ...req.headers }

    // REPLACE — never append or trust the client-supplied chain.
    // This proxy is the outermost hop; there is no legitimate prior chain.
    headers['x-forwarded-for'] = peer
    headers['x-real-ip'] = peer
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
