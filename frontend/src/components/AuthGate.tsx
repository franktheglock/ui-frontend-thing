import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { Loader2, Shield, User, LogOut } from 'lucide-react'

function AuthScreen() {
  const { login, register, loading } = useAuthStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    if (mode === 'login') {
      const r = await login(email, password)
      if (!r.ok) {
        if (r.pending) {
          setPending(true)
        } else setError(r.error || 'Login failed')
      }
    } else {
      if (!email || !password) { setError('Email and password required'); setSubmitting(false); return }
      if (password.length < 8) { setError('Password must be at least 8 characters'); setSubmitting(false); return }
      const r = await register(email, password, displayName)
      if (!r.ok) setError(r.error || 'Registration failed')
      else if (r.pending) setPending(true)
    }
    setSubmitting(false)
  }

  if (pending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
            <Shield className="w-6 h-6 text-amber-500" />
          </div>
          <h2 className="text-xl font-semibold">Awaiting admin approval</h2>
          <p className="text-sm text-muted-foreground">Your account <strong>{email}</strong> has been created. An admin must approve your login and set your spend limits / allowed providers before you can chat.</p>
          <p className="text-xs text-muted-foreground">You'll need to log in again after approval.</p>
          <button onClick={() => { setPending(false); setMode('login') }} className="w-full mt-2 py-2 rounded-md bg-primary text-primary-foreground text-sm">Back to login</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-border bg-card p-8 space-y-5">
        <div className="text-center space-y-1">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">AI Chat UI</h1>
          <p className="text-sm text-muted-foreground">{mode === 'login' ? 'Sign in to continue' : 'Create your account'}</p>
          <p className="text-xs text-muted-foreground">Admin will approve, set your spend limits & providers.</p>
        </div>

        {mode === 'register' && (
          <div>
            <label className="text-xs font-medium">Display name (optional)</label>
            <input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Jane Doe" className="mt-1 w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
        )}
        <div>
          <label className="text-xs font-medium">Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required className="mt-1 w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div>
          <label className="text-xs font-medium">Password</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required className="mt-1 w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          {mode==='register' && <p className="text-[11px] text-muted-foreground mt-1">At least 8 characters</p>}
        </div>

        {error && <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{error}</div>}

        <button type="submit" disabled={submitting || loading} className="w-full py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
          {submitting && <Loader2 className="w-4 h-4 animate-spin"/>}
          {mode==='login' ? 'Sign in' : 'Create account'}
        </button>

        <div className="text-center text-sm">
          {mode==='login' ? (
            <span>Don't have an account? <button type="button" onClick={()=>{setMode('register'); setError(null)}} className="text-primary underline">Create one</button></span>
          ) : (
            <span>Already have an account? <button type="button" onClick={()=>{setMode('login'); setError(null)}} className="text-primary underline">Sign in</button></span>
          )}
        </div>

      </form>
    </div>
  )
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, fetchMe, logout } = useAuthStore()

  useEffect(() => { fetchMe() }, [fetchMe])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <AuthScreen />
  }

  // approved check: if pending, show pending screen (shouldn't happen since login blocks, but if user was approved then revoked)
  if ((user as any).status !== 'approved') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center space-y-4">
          <Shield className="w-8 h-8 mx-auto text-amber-500" />
          <h2 className="text-lg font-semibold">Account not approved</h2>
          <p className="text-sm text-muted-foreground">Status: {(user as any).status}. Please contact an admin.</p>
          <button onClick={logout} className="inline-flex items-center gap-2 px-4 py-2 rounded-md border text-sm"><LogOut className="w-4 h-4"/> Sign out</button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
