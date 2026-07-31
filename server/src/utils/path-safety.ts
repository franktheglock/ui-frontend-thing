import fs from 'fs'
import path from 'path'

/**
 * Resolve `userPath` under `baseDir`. Returns null if the result escapes baseDir
 * (path traversal via `..`, absolute paths, or symlinks that resolve outside).
 */
export function resolveWithin(baseDir: string, userPath: string): string | null {
  if (userPath == null || typeof userPath !== 'string' || userPath.trim() === '') {
    return null
  }

  // Reject absolute paths and Windows drive letters
  if (path.isAbsolute(userPath) || /^[a-zA-Z]:[\\/]/.test(userPath)) {
    return null
  }

  if (userPath.includes('\0')) {
    return null
  }

  let resolvedBase: string
  try {
    resolvedBase = fs.existsSync(baseDir)
      ? fs.realpathSync(path.resolve(baseDir))
      : path.resolve(baseDir)
  } catch {
    resolvedBase = path.resolve(baseDir)
  }

  const resolved = path.resolve(resolvedBase, userPath)

  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    return null
  }

  // Symlink check: if the path (or nearest existing ancestor) realpaths outside base, reject
  try {
    if (fs.existsSync(resolved)) {
      const realPath = fs.realpathSync(resolved)
      if (realPath !== resolvedBase && !realPath.startsWith(resolvedBase + path.sep)) {
        return null
      }
      return realPath
    }

    // New file / missing path — walk up to deepest existing ancestor
    let ancestor = path.dirname(resolved)
    while (true) {
      if (fs.existsSync(ancestor)) {
        const realAncestor = fs.realpathSync(ancestor)
        if (realAncestor !== resolvedBase && !realAncestor.startsWith(resolvedBase + path.sep)) {
          return null
        }
        const rel = path.relative(ancestor, resolved)
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          return null
        }
        const candidate = path.resolve(realAncestor, rel)
        if (candidate !== resolvedBase && !candidate.startsWith(resolvedBase + path.sep)) {
          return null
        }
        return candidate
      }
      if (ancestor === resolvedBase || ancestor === path.dirname(ancestor)) {
        break
      }
      ancestor = path.dirname(ancestor)
    }
  } catch {
    return null
  }

  return resolved
}

/**
 * Like resolveWithin, but throws with a clear error message.
 */
export function mustResolveWithin(baseDir: string, userPath: string, label = 'path'): string {
  const resolved = resolveWithin(baseDir, userPath)
  if (!resolved) {
    throw new Error(`Invalid ${label}: path escapes allowed directory`)
  }
  return resolved
}

/**
 * Return true if `candidate` is strictly inside (or equal to) `baseDir`,
 * using realpath when paths exist.
 */
export function isInsideDir(baseDir: string, candidate: string): boolean {
  try {
    const resolvedBase = fs.existsSync(baseDir)
      ? fs.realpathSync(path.resolve(baseDir))
      : path.resolve(baseDir)
    const resolved = fs.existsSync(candidate)
      ? fs.realpathSync(path.resolve(candidate))
      : path.resolve(candidate)
    return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep)
  } catch {
    return false
  }
}

/**
 * True if a hostname is loopback (localhost / 127.0.0.0/8 / ::1).
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1') return true
  if (host === '127.0.0.1') return true
  // 127.0.0.0/8
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  return false
}

/**
 * True if the remote address is a loopback client.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  if (address === '::1' || address === '127.0.0.1') return true
  if (address === '::ffff:127.0.0.1') return true
  if (address.startsWith('::ffff:127.')) return true
  return false
}

/**
 * Client IP for access control.
 *
 * - Direct (non-loopback) peer: use socket address; ignore client XFF entirely.
 * - Loopback peer: our https-proxy.mjs overwrites X-Real-IP / XFF with its TCP
 *   peer, so a loopback claim is truthful (same-machine browser via the proxy).
 * - TRUST_PROXY=true with a non-loopback peer: external proxy we do not fully
 *   vouch for — take rightmost hop / X-Real-IP, but never grant loopback
 *   privilege from those headers (downgrade to a non-local sentinel).
 */
export function getClientIp(req: {
  socket: { remoteAddress?: string }
  headers: Record<string, string | string[] | undefined>
}): string | undefined {
  const remote = req.socket.remoteAddress
  const peerIsLoopback = isLoopbackAddress(remote)
  const trustProxyEnv =
    process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1'

  // Direct client connection — ignore any client-supplied forwarding headers
  if (!peerIsLoopback && !trustProxyEnv) {
    return remote
  }

  // A loopback peer is our own https-proxy.mjs, which overwrites these headers
  // with its TCP peer — so a "127.0.0.1" claim from it is truthful.
  // An external TRUST_PROXY hop is not vouched for, so a loopback claim from
  // one is downgraded to untrusted-remote.
  const allowLoopbackClaim = peerIsLoopback

  const xri = req.headers['x-real-ip']
  const real = Array.isArray(xri) ? xri[0] : xri
  if (typeof real === 'string' && real.trim()) {
    const ip = real.trim()
    if (isLoopbackAddress(ip) && !allowLoopbackClaim) {
      return '203.0.113.1' // TEST-NET-3 sentinel: non-local, non-private
    }
    return ip
  }

  const xff = req.headers['x-forwarded-for']
  const raw = Array.isArray(xff) ? xff[0] : xff
  if (typeof raw === 'string' && raw.trim()) {
    const hops = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const ip = hops[hops.length - 1] || '' // rightmost = set by the immediate proxy
    if (ip) {
      if (isLoopbackAddress(ip) && !allowLoopbackClaim) {
        return '203.0.113.1'
      }
      return ip
    }
  }

  // Loopback peer, no forwarding headers = genuine local client
  return remote
}
