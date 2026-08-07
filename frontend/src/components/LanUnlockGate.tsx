import React, { useEffect, useState } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import { getApiToken, setApiToken } from '../lib/apiAuth'

/**
 * Shown when the API returns AUTH_REQUIRED (LAN token needed).
 * Lets the user paste the access token from Settings on the host machine.
 */
export function LanUnlockGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const [needsUnlock, setNeedsUnlock] = useState(false)
  const [token, setToken] = useState(getApiToken())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function probe() {
      try {
        // Probe LAN token requirement via a lightweight public endpoint that is NOT gated by cookie auth.
        // /api/network is public (see security.isBootstrap) and returns 403 LAN_DISABLED when LAN is off.
        // We must NOT probe /api/providers here - that is gated by cookie auth (LOGIN_REQUIRED) and would
        // incorrectly trigger the LAN unlock screen for unauthenticated users.
        const res = await fetch('/api/network', { credentials: 'include' })
        if (cancelled) return
        if (res.status === 401 || res.status === 403) {
          const body = await res.json().catch(() => ({}))
          // Only treat LAN-specific codes as needing unlock. Cookie auth uses LOGIN_REQUIRED which is handled by AuthGate.
          const lanCodes = new Set(['AUTH_REQUIRED', 'TOKEN_MISSING', 'LAN_DISABLED'])
          if (body?.code && lanCodes.has(body.code)) {
            setNeedsUnlock(true)
          } else {
            // Check if it's truly a LAN token error by also probing providers with token header missing case.
            // For safety, don't block UI on generic 401 - let AuthGate handle login.
            setNeedsUnlock(false)
          }
        } else {
          setNeedsUnlock(false)
        }
      } catch {
        // network error — don't block UI
        setNeedsUnlock(false)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    probe()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/network/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) {
        setError(body.error || 'Invalid token')
        return
      }
      setApiToken(token.trim())
      setNeedsUnlock(false)
    } catch (err: any) {
      setError(err.message || 'Failed to unlock')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Connecting…</span>
      </div>
    )
  }

  if (!needsUnlock) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md border border-border rounded-sm bg-card p-6 space-y-4 shadow-xl">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-accent" />
          <h1 className="text-base font-medium">Access token required</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          This server has LAN access enabled with a required token. On the host machine open{' '}
          <span className="text-foreground">Settings → General → Network</span>, copy the access
          token, and paste it here.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Access token"
            autoFocus
            className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !token.trim()}
            className="w-full px-3 py-2 bg-accent text-accent-foreground rounded-sm text-sm hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  )
}
