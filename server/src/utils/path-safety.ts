import path from 'path'

/**
 * Resolve `userPath` under `baseDir`. Returns null if the result escapes baseDir
 * (path traversal via `..`, absolute paths, symlinks resolved outside, etc.).
 */
export function resolveWithin(baseDir: string, userPath: string): string | null {
  if (userPath == null || typeof userPath !== 'string' || userPath.trim() === '') {
    return null
  }

  // Reject absolute paths and Windows drive letters
  if (path.isAbsolute(userPath) || /^[a-zA-Z]:[\\/]/.test(userPath)) {
    return null
  }

  const resolvedBase = path.resolve(baseDir)
  const resolved = path.resolve(resolvedBase, userPath)

  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
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
 * Return true if `candidate` is strictly inside (or equal to) `baseDir`.
 */
export function isInsideDir(baseDir: string, candidate: string): boolean {
  const resolvedBase = path.resolve(baseDir)
  const resolved = path.resolve(candidate)
  return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep)
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
