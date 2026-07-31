import type { Server } from 'http'

export interface ListenInfo {
  host: string
  port: number
  /** True when HOST was set in the environment — we will not rebind. */
  hostLocked: boolean
}

let httpServer: Server | null = null
let currentHost = '127.0.0.1'
let currentPort = 3456
let hostLocked = false
let onListening: (() => void) | null = null

export function initListenControl(opts: {
  server: Server
  host: string
  port: number
  hostLocked: boolean
  onListening?: () => void
}) {
  httpServer = opts.server
  currentHost = opts.host
  currentPort = opts.port
  hostLocked = opts.hostLocked
  onListening = opts.onListening || null
}

export function getListenInfo(): ListenInfo {
  return {
    host: currentHost,
    port: currentPort,
    hostLocked,
  }
}

/**
 * When LAN is enabled, prefer binding 0.0.0.0 so other devices can connect.
 * When disabled, prefer 127.0.0.1.
 * No-op if HOST was set explicitly via environment.
 */
export async function setLanBindEnabled(enabled: boolean): Promise<ListenInfo> {
  if (hostLocked || !httpServer) {
    return getListenInfo()
  }

  const target = enabled ? '0.0.0.0' : '127.0.0.1'
  if (target === currentHost) {
    return getListenInfo()
  }

  await new Promise<void>((resolve, reject) => {
    httpServer!.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })

  currentHost = target

  await new Promise<void>((resolve, reject) => {
    httpServer!.listen(currentPort, currentHost, () => {
      console.log(`[server] Rebound to http://${currentHost}:${currentPort}`)
      onListening?.()
      resolve()
    })
    httpServer!.once('error', reject)
  })

  return getListenInfo()
}
