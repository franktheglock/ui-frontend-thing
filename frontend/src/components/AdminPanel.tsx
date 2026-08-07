import { useEffect, useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, X, Trash2, Shield, DollarSign, Loader2, Save, ChevronDown, Search } from 'lucide-react'
import { getProviderIcon } from '../lib/providerIcons'

interface UserRow {
  id: string
  email: string
  displayName: string
  role: string
  status: string
  spendLimit: number
  spendUsed: number
  allowedProviders: string[] | null
  createdAt: number
}

interface AliasRow {
  id: string
  displayName: string
  providerId: string
  model: string
  description: string
  enabled: boolean
}

export function AdminPanel({ onClose }: { onClose?: () => void }) {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [aliases, setAliases] = useState<AliasRow[]>([])
  const [providers, setProviders] = useState<any[]>([])
  const [simplified, setSimplified] = useState(false)
  const [newAlias, setNewAlias] = useState({ displayName: '', providerId: '', model: '', description: '' })
  const [savingId, setSavingId] = useState<string | null>(null)
  const [providerOpen, setProviderOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const providerBtnRef = useRef<HTMLButtonElement>(null)
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const [providerRect, setProviderRect] = useState<DOMRect | null>(null)
  const [modelRect, setModelRect] = useState<DOMRect | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [uRes, aRes, pRes, sRes] = await Promise.all([
        fetch('/api/auth/users', { credentials: 'include' }),
        fetch('/api/model-aliases', { credentials: 'include' }),
        fetch('/api/providers', { credentials: 'include' }),
        fetch('/api/settings', { credentials: 'include' }),
      ])
      if (uRes.ok) setUsers(await uRes.json())
      if (aRes.ok) setAliases(await aRes.json())
      if (pRes.ok) setProviders(await pRes.json())
      if (sRes.ok) {
        const data = await sRes.json()
        setSimplified(!!data.settings?.useSimplifiedPicker)
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const selectedProvider = useMemo(() => providers.find((p: any) => p.id === newAlias.providerId) || null, [providers, newAlias.providerId])
  const providerModels: string[] = useMemo(() => {
    if (!selectedProvider) return []
    const ms = (selectedProvider.models || []) as string[]
    return Array.from(new Set(ms))
  }, [selectedProvider])
  const filteredModels = useMemo(() => {
    if (!modelSearch.trim()) return providerModels
    const q = modelSearch.toLowerCase()
    return providerModels.filter(m => m.toLowerCase().includes(q))
  }, [providerModels, modelSearch])

  const updateUser = async (id: string, patch: any) => {
    setSavingId(id)
    const res = await fetch(`/api/auth/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(patch) })
    if (res.ok) load()
    setSavingId(null)
  }
  const approve = async (u: UserRow) => {
    const spend = prompt(`Spend limit for ${u.email} (0 = unlimited):`, String(u.spendLimit || 0))
    if (spend === null) return
    const allowed = prompt(`Allowed providers (comma separated ids, empty = all). Available: ${providers.map((p:any)=>p.id).join(',')}`, (u.allowedProviders||[]).join(','))
    const allowedArr = allowed ? allowed.split(',').map(s=>s.trim()).filter(Boolean) : null
    setSavingId(u.id)
    await fetch(`/api/auth/users/${u.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ spendLimit: Number(spend)||0, allowedProviders: allowedArr }) })
    load()
    setSavingId(null)
  }
  const reject = async (id: string) => { setSavingId(id); await fetch(`/api/auth/users/${id}/reject`, { method: 'POST', credentials: 'include' }); load(); setSavingId(null) }
  const del = async (id: string) => { if (!confirm('Delete user?')) return; await fetch(`/api/auth/users/${id}`, { method: 'DELETE', credentials: 'include' }); load() }

  const toggleSimplified = async (val: boolean) => {
    setSimplified(val)
    await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ useSimplifiedPicker: val }) })
  }
  const createAlias = async () => {
    if (!newAlias.displayName || !newAlias.providerId || !newAlias.model) { alert('displayName, provider, model required'); return }
    const res = await fetch('/api/model-aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(newAlias) })
    if (!res.ok) { alert((await res.json()).error || 'Failed'); return }
    setNewAlias({ displayName: '', providerId: '', model: '', description: '' })
    setModelSearch('')
    load()
  }
  const deleteAlias = async (id: string) => { await fetch(`/api/model-aliases/${id}`, { method: 'DELETE', credentials: 'include' }); load() }

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin"/></div>

  return (
    <div className="space-y-6 max-h-[80vh] overflow-auto p-1">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Shield className="w-5 h-5"/> Admin</h2>
        {onClose && <button onClick={onClose} className="p-1 rounded hover:bg-secondary"><X className="w-4 h-4"/></button>}
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Users & Approvals</h3>
        <div className="border rounded-md divide-y max-h-72 overflow-auto">
          {users.map(u => (
            <div key={u.id} className="p-3 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">{u.email} <span className="text-xs text-muted-foreground">({u.role})</span> <span className={`text-xs px-1.5 py-0.5 rounded ${u.status==='approved'?'bg-green-500/15 text-green-600':u.status==='pending'?'bg-amber-500/15 text-amber-600':'bg-red-500/15 text-red-600'}`}>{u.status}</span></div>
                <div className="text-xs text-muted-foreground flex items-center gap-2"><DollarSign className="w-3 h-3"/>{u.spendUsed?.toFixed?.(2) ?? 0} / {u.spendLimit === 0 ? '∞' : `$${Number(u.spendLimit).toFixed(2)}`} {u.allowedProviders ? `· ${u.allowedProviders.join(',')}` : '· all providers'}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {u.status === 'pending' && <button disabled={savingId===u.id} onClick={()=>approve(u)} className="px-2 py-1 rounded bg-green-600 text-white text-xs flex items-center gap-1"><Check className="w-3 h-3"/>Approve</button>}
                {u.status === 'pending' && <button disabled={savingId===u.id} onClick={()=>reject(u.id)} className="px-2 py-1 rounded border text-xs flex items-center gap-1"><X className="w-3 h-3"/>Reject</button>}
                <button title="Set limit" onClick={()=>{
                  const v = prompt('New spend limit (0 unlimited)', String(u.spendLimit))
                  if (v!==null) updateUser(u.id, { spendLimit: Number(v)||0 })
                }} className="p-1.5 border rounded hover:bg-secondary" ><DollarSign className="w-3 h-3"/></button>
                <button title="Allowed providers" onClick={()=>{
                  const cur = (u.allowedProviders||[]).join(',')
                  const v = prompt(`Allowed providers (comma separated, empty=all)\nAvailable: ${providers.map((p:any)=>p.id).join(',')}`, cur)
                  if (v!==null) updateUser(u.id, { allowedProviders: v ? v.split(',').map((s:string)=>s.trim()).filter(Boolean) : null })
                }} className="px-2 py-1 border rounded text-xs">Providers</button>
                <button onClick={()=>del(u.id)} className="p-1.5 hover:bg-destructive/10 text-destructive rounded"><Trash2 className="w-3 h-3"/></button>
              </div>
            </div>
          ))}
          {users.length===0 && <div className="p-4 text-sm text-muted-foreground">No users.</div>}
        </div>
      </section>

      <section className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={simplified} onChange={e=>toggleSimplified(e.target.checked)} />
          Enable simplified model picker (hide providers, show only aliases)
        </label>
        <p className="text-xs text-muted-foreground">When enabled, non-admin users see only the custom names you map below. Map any provider/model combo to a friendly name.</p>

        <h4 className="text-sm font-medium pt-2">Model Aliases (custom names)</h4>
        <div className="border rounded-md p-3 space-y-3 bg-secondary/20">
          <input placeholder="Display name (e.g. Fast Chat)" value={newAlias.displayName} onChange={e=>setNewAlias({ ...newAlias, displayName: e.target.value })} className="w-full px-3 py-2 bg-background border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring" />

          {/* Provider picker - matches ModelPicker style */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="relative">
              <button
                ref={providerBtnRef}
                type="button"
                onClick={() => {
                  if (!providerOpen && providerBtnRef.current) setProviderRect(providerBtnRef.current.getBoundingClientRect())
                  setProviderOpen(o => !o); setModelOpen(false)
                }}
                className="w-full flex items-center justify-between px-3 py-2 bg-background border border-border rounded-sm text-sm hover:bg-secondary/30 transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {selectedProvider ? (
                    <>
                      {(() => { const Icon = getProviderIcon(selectedProvider.id); return <Icon size={15} className="shrink-0 opacity-80" /> })()}
                      <span className="truncate font-medium">{selectedProvider.name}</span>
                      <span className="text-xs text-muted-foreground truncate">({selectedProvider.id})</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Select provider</span>
                  )}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${providerOpen ? 'rotate-180' : ''}`} />
              </button>
              {providerOpen && providerRect && createPortal(
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProviderOpen(false)} />
                  <div
                    className="fixed z-50 bg-card border border-border rounded-sm shadow-xl max-h-56 overflow-auto"
                    style={{ top: providerRect.bottom + 4, left: providerRect.left, width: providerRect.width }}
                  >
                    {providers.map((p: any) => {
                      const Icon = getProviderIcon(p.id)
                      const isSel = newAlias.providerId === p.id
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setNewAlias({ ...newAlias, providerId: p.id, model: '' }); setProviderOpen(false); setModelSearch('') }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/50 ${isSel ? 'bg-accent/10 text-accent' : ''}`}
                        >
                          <Icon size={15} className="shrink-0 opacity-80" />
                          <span className="flex-1 truncate font-medium">{p.name}</span>
                          <span className="text-xs text-muted-foreground">{p.models?.length || 0} models</span>
                          {isSel && <Check className="w-3.5 h-3.5 ml-1" />}
                        </button>
                      )
                    })}
                    {providers.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No providers</div>}
                  </div>
                </>,
                document.body
              )}
            </div>

            {/* Model picker - dropdown of provider models */}
            <div className="relative">
              <button
                ref={modelBtnRef}
                type="button"
                disabled={!selectedProvider}
                onClick={() => {
                  if (!selectedProvider) return;
                  if (!modelOpen && modelBtnRef.current) setModelRect(modelBtnRef.current.getBoundingClientRect())
                  setModelOpen(o => !o); setProviderOpen(false)
                }}
                className="w-full flex items-center justify-between px-3 py-2 bg-background border border-border rounded-sm text-sm hover:bg-secondary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="truncate text-left flex-1">
                  {newAlias.model ? <span className="font-mono text-xs">{newAlias.model}</span> : <span className="text-muted-foreground">{selectedProvider ? 'Select model' : 'Pick provider first'}</span>}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground ml-2 shrink-0 transition-transform ${modelOpen ? 'rotate-180' : ''}`} />
              </button>
              {modelOpen && selectedProvider && modelRect && createPortal(
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setModelOpen(false)} />
                  <div
                    className="fixed z-50 bg-card border border-border rounded-sm shadow-xl max-h-64 flex flex-col overflow-hidden"
                    style={{ top: modelRect.bottom + 4, left: modelRect.left, width: modelRect.width }}
                  >
                    <div className="p-2 border-b border-border">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <input
                          autoFocus
                          placeholder="Search models..."
                          value={modelSearch}
                          onChange={e => setModelSearch(e.target.value)}
                          className="w-full pl-7 pr-2 py-1.5 bg-secondary border border-border rounded-sm text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto">
                      {filteredModels.length === 0 ? (
                        <div className="px-3 py-6 text-center">
                          <p className="text-xs text-muted-foreground">{providerModels.length === 0 ? 'No models for this provider' : 'No match'}</p>
                          {providerModels.length === 0 && (
                            <input
                              placeholder="Type custom model id"
                              value={newAlias.model}
                              onChange={e => setNewAlias({ ...newAlias, model: e.target.value })}
                              className="mt-2 w-full px-2 py-1.5 bg-secondary border border-border rounded-sm text-xs"
                            />
                          )}
                        </div>
                      ) : (
                        filteredModels.map(m => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => { setNewAlias({ ...newAlias, model: m }); setModelOpen(false) }}
                            className={`w-full text-left px-3 py-2 text-xs font-mono hover:bg-secondary/50 flex items-center justify-between ${newAlias.model === m ? 'bg-accent/10 text-accent' : ''}`}
                          >
                            <span className="truncate pr-2">{m}</span>
                            {newAlias.model === m && <Check className="w-3 h-3 shrink-0" />}
                          </button>
                        ))
                      )}
                    </div>
                    {providerModels.length > 0 && (
                      <div className="p-2 border-t border-border">
                        <input
                          placeholder="Or enter custom model"
                          value={newAlias.model}
                          onChange={e => setNewAlias({ ...newAlias, model: e.target.value })}
                          className="w-full px-2 py-1.5 bg-secondary border border-border rounded-sm text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    )}
                  </div>
                </>,
                document.body
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <input placeholder="Description (optional)" value={newAlias.description} onChange={e=>setNewAlias({ ...newAlias, description: e.target.value })} className="flex-1 px-3 py-2 bg-background border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            <button onClick={createAlias} className="px-4 py-2 rounded-sm bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 hover:bg-primary/90"><Save className="w-3.5 h-3.5"/>Add</button>
          </div>

          <div className="divide-y border-t pt-2">
            {aliases.map(a => {
              const prov = providers.find((p: any) => p.id === a.providerId)
              const Icon = getProviderIcon(a.providerId)
              return (
                <div key={a.id} className="py-2.5 flex items-center gap-2 text-sm">
                  <Icon size={14} className="shrink-0 opacity-70" />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{a.displayName}</span>
                    <span className="text-muted-foreground"> → {prov ? prov.name : a.providerId} </span>
                    <span className="font-mono text-xs bg-secondary px-1 py-0.5 rounded">{a.model}</span>
                    {a.description && <span className="text-xs text-muted-foreground"> — {a.description}</span>}
                  </div>
                  <button onClick={()=>deleteAlias(a.id)} className="p-1.5 hover:bg-destructive/10 text-destructive rounded-sm shrink-0"><Trash2 className="w-3.5 h-3.5"/></button>
                </div>
              )
            })}
            {aliases.length===0 && <div className="text-xs text-muted-foreground py-3 text-center">No aliases yet. Pick a provider and model above.</div>}
          </div>
        </div>
      </section>
    </div>
  )
}
