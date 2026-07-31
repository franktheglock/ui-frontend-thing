/**
 * HTTPS reverse proxy for the AI Chat UI.
 * Serves HTTPS with a self-signed cert, proxying to the HTTP server on port 5183.
 * This lets the browser extension iframe the page without mixed-content blocking.
 *
 * Usage: node https-proxy.js
 * Listens on port 5184 (HTTPS) -> forwards to 5183 (HTTP)
 */
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 5183;
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '5184', 10);
const CERT_DIR = process.env.CERT_DIR || path.join(__dirname, 'certs');

// ── Generate self-signed cert on first run ──
function ensureCert() {
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  console.log('[https-proxy] Generating self-signed certificate...');
  fs.mkdirSync(CERT_DIR, { recursive: true });

  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes ` +
    `-subj "/CN=192.168.1.129/O=AI-Chat-Proxy/C=US" ` +
    `-addext "subjectAltName=DNS:localhost,IP:192.168.1.129,IP:127.0.0.1"`,
    { stdio: 'pipe' }
  );

  console.log('[https-proxy] Certificate generated at', certPath);
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

// ── Create proxy server ──
function startProxy() {
  const { key, cert } = ensureCert();

  const server = https.createServer({ key, cert }, (req, res) => {
    const options = {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        // Ensure framing is allowed
        'X-Frame-Options': '',
      },
    };

    // Remove hop-by-hop headers
    delete options.headers['connection'];
    delete options.headers['keep-alive'];
    delete options.headers['proxy-connection'];
    delete options.headers['transfer-encoding'];
    delete options.headers['upgrade'];

    const proxyReq = http.request(options, (proxyRes) => {
      // Remove security headers that block iframing
      const outgoingHeaders = { ...proxyRes.headers };
      delete outgoingHeaders['x-frame-options'];
      delete outgoingHeaders['x-content-security-policy'];
      delete outgoingHeaders['content-security-policy'];
      // Add framing-permissive header
      outgoingHeaders['X-Frame-Options'] = 'ALLOWALL';

      res.writeHead(proxyRes.statusCode || 200, outgoingHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[https-proxy] Proxy error:', err.message);
      try {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway: ' + err.message);
      } catch {}
    });

    req.pipe(proxyReq);
  });

  server.listen(PROXY_PORT, '0.0.0.0', () => {
    console.log(`[https-proxy] Listening on https://0.0.0.0:${PROXY_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`);
  });

  server.on('error', (err) => {
    console.error('[https-proxy] Server error:', err.message);
    process.exit(1);
  });
}

startProxy();
