import { create } from 'zustand'

export interface AuthUser {
  id: string
  email: string
  displayName: string
  display_name: string
  role: 'admin' | 'user'
  status: 'pending' | 'approved' | 'rejected'
  spendLimit: number
  spend_limit: number
  spendUsed: number
  spend_used: number
  allowedProviders: string[] | null
  allowed_providers: string[] | null
  createdAt: number
  approvedAt?: number
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  error: string | null
  isAdmin: boolean
  isApproved: boolean
  fetchMe: () => Promise<void>
  login: (email: string, password: string) => Promise<{ ok: boolean; pending?: boolean; error?: string }>
  register: (email: string, password: string, displayName?: string) => Promise<{ ok: boolean; pending?: boolean; error?: string }>
  logout: () => Promise<void>
  setupAdmin: (email: string, password: string, displayName?: string) => Promise<{ ok: boolean; error?: string }>
  checkSetupStatus: () => Promise<{ hasAdmin: boolean; hasAnyUser: boolean; setupComplete: boolean }>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  error: null,
  isAdmin: false,
  isApproved: false,
  fetchMe: async () => {
    try {
      set({ loading: true, error: null })
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const u = data.user as AuthUser
        set({ user: u, isAdmin: u.role === 'admin', isApproved: u.status === 'approved', loading: false })
      } else if (res.status === 401 || res.status === 403) {
        set({ user: null, isAdmin: false, isApproved: false, loading: false })
      } else {
        set({ loading: false })
      }
    } catch (e: any) {
      set({ loading: false, error: e.message })
    }
  },
  login: async (email, password) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        await get().fetchMe()
        return { ok: true }
      }
      if (data.code === 'PENDING_APPROVAL') return { ok: false, pending: true, error: data.error }
      return { ok: false, error: data.error || 'Login failed' }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  },
  register: async (email, password, displayName) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, displayName }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 201 && data.pending) {
        return { ok: true, pending: true }
      }
      if (res.ok) {
        await get().fetchMe()
        return { ok: true }
      }
      return { ok: false, error: data.error || 'Registration failed' }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  },
  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    set({ user: null, isAdmin: false, isApproved: false })
  },
  setupAdmin: async (email, password, displayName) => {
    try {
      const res = await fetch('/api/auth/setup-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, displayName }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        await get().fetchMe()
        return { ok: true }
      }
      return { ok: false, error: data.error || 'Setup failed' }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  },
  checkSetupStatus: async () => {
    const res = await fetch('/api/auth/setup-status', { credentials: 'include' })
    if (!res.ok) return { hasAdmin: true, hasAnyUser: true, setupComplete: true }
    return await res.json()
  },
}))
