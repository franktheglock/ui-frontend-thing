import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  MessageSquare,
  ImagePlus,
  Plus,
  Trash2,
  Settings,
  ChevronLeft,
  Search,
  Wrench,
  Zap,
  Pencil,
  Sun,
  File,
  Bot,
  Loader2,
} from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getPathnameForView, getViewFromPathname, useUIStore } from '../stores/uiStore'
import { cn, formatDate } from '../lib/utils'

interface HermesSession {
  id: string
  title: string
  preview?: string
  message_count?: number
  last_active?: number
}

export function Sidebar() {
  const { sessions, currentSessionId, createSession, setCurrentSession, deleteSession, renameSession } = useChatStore()
  const { sidebarOpen, toggleSidebar, theme, setTheme, selectedProvider } = useSettingsStore()
  const { setCurrentView, setSettingsOpen, setToolSelectorOpen, setSearchHighlight } = useUIStore()
  const navigate = useNavigate()
  const location = useLocation()
  const currentView = getViewFromPathname(location.pathname)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const isHermesMode = selectedProvider === 'hermes-agent'

  // Hermes sessions state
  const [hermesSessions, setHermesSessions] = useState<HermesSession[]>([])
  const [hermesLoading, setHermesLoading] = useState(false)
  const [hermesError, setHermesError] = useState<string | null>(null)

  const loadHermesSessions = async () => {
    setHermesLoading(true)
    setHermesError(null)
    try {
      const res = await fetch('/api/hermes/api/sessions?limit=50')
      if (!res.ok) {
        setHermesError(res.status === 503 ? 'Not configured' : 'API error')
        setHermesSessions([])
        return
      }
      const data = await res.json()
      const list = Array.isArray(data) ? data : data.sessions || data.data || []
      setHermesSessions(list)
    } catch {
      setHermesError('Connection failed')
      setHermesSessions([])
    } finally {
      setHermesLoading(false)
    }
  }

  // Auto-load hermes sessions when entering hermes mode
  useEffect(() => {
    if (isHermesMode && hermesSessions.length === 0 && !hermesLoading) {
      loadHermesSessions()
    }
  }, [isHermesMode])

  const filteredSessions = sessions.filter(s => {
    if (s.provider === 'hermes-agent') return false
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    if (s.title.toLowerCase().includes(q)) return true
    return s.messages.some(m => m.content.toLowerCase().includes(q))
  })

  const getMatchInfo = (session: typeof sessions[0]): { snippet: string; messageId: string } | null => {
    if (!searchQuery) return null
    const q = searchQuery.toLowerCase()
    if (session.title.toLowerCase().includes(q)) return null
    for (const m of session.messages) {
      const idx = m.content.toLowerCase().indexOf(q)
      if (idx !== -1) {
        const start = Math.max(0, idx - 20)
        const end = Math.min(m.content.length, idx + searchQuery.length + 30)
        const prefix = start > 0 ? '…' : ''
        const suffix = end < m.content.length ? '…' : ''
        return {
          snippet: `${prefix}${m.content.slice(start, end).trim()}${suffix}`,
          messageId: m.id,
        }
      }
    }
    return null
  }

  const handleRename = (id: string, title: string) => {
    setEditingId(id)
    setEditTitle(title)
  }

  const submitRename = async () => {
    if (editingId && editTitle.trim()) {
      await renameSession(editingId, editTitle.trim())
    }
    setEditingId(null)
  }

  const loadHermesSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/hermes/api/sessions/${sessionId}/messages`)
      if (!res.ok) return
      const data = await res.json()
      const msgs = Array.isArray(data) ? data : data.messages || data.data || []

      const haProvider = useSettingsStore.getState().providers.find(p => p.id === 'hermes-agent')
      const model = haProvider?.models?.[0] || 'hermes-agent'
      useSettingsStore.getState().setSelectedModelAndProvider(model, 'hermes-agent')

      const newId = await createSession('hermes-agent', 'hermes-agent')
      setCurrentSession(newId)

      for (const msg of msgs) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          const content = (msg.content || '').trim()
          // Skip title-generation messages that Hermes auto-injects
          if (content.startsWith('Create a short') && content.includes('title for this chat')) continue
          if (content.length === 0) continue
          await useChatStore.getState().addMessage(newId, {
            role: msg.role,
            content: msg.content || '',
            thinking: msg.reasoning_content || msg.thinking || undefined,
            responseId: msg.id ? String(msg.id) : undefined,
            timestamp: msg.timestamp || Date.now(),
          } as any)
        }
      }
    } catch (err) {
      console.error('Failed to load Hermes session:', err)
    }
  }

  const switchToHermes = () => {
    const haProvider = useSettingsStore.getState().providers.find(p => p.id === 'hermes-agent')
    const model = haProvider?.models?.[0] || 'hermes-agent'
    useSettingsStore.getState().setSelectedModelAndProvider(model, 'hermes-agent')
    setCurrentView('chat')
    navigate('/')
  }

  return (
    <AnimatePresence initial={false}>
      {sidebarOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={toggleSidebar}
          />
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-border bg-card/95 backdrop-blur-sm flex flex-col md:relative md:z-auto md:bg-card/50"
          >
          <div className="p-3 border-b border-border flex items-center justify-between">
            <div className={cn('flex items-center gap-2', isHermesMode ? 'text-emerald-400' : 'text-accent')}>
              {isHermesMode ? <Bot className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
              <span className="font-display font-bold text-lg tracking-tight">
                {isHermesMode ? 'Hermes Agent' : 'AI Chat'}
              </span>
            </div>
            <button
              onClick={toggleSidebar}
              className="p-1.5 hover:bg-secondary rounded-none transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 space-y-2">
            <button
              onClick={async () => {
                const { selectedModel, selectedProvider } = useSettingsStore.getState()
                setCurrentView('chat')
                navigate(getPathnameForView('chat'))
                await createSession(selectedModel, selectedProvider)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 bg-accent text-accent-foreground rounded-none hover:bg-accent/90 transition-colors font-medium text-sm"
            >
              <Plus className="w-4 h-4" />
              {isHermesMode ? 'New Agent Chat' : 'New Chat'}
            </button>

            <button
              onClick={() => {
                setCurrentView('image-studio')
                navigate(getPathnameForView('image-studio'))
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 border text-sm transition-colors',
                currentView === 'image-studio'
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground hover:border-accent/30'
              )}
            >
              <ImagePlus className="w-4 h-4" />
              Image Studio
            </button>

            <button
              onClick={() => {
                setCurrentView('files')
                navigate(getPathnameForView('files'))
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 border text-sm transition-colors',
                currentView === 'files'
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground hover:border-accent/30'
              )}
            >
              <File className="w-4 h-4" />
              Files
            </button>

            {/* Hermes Agent mode switch */}
            <button
              onClick={isHermesMode ? () => {
                // Switch back to a non-hermes provider
                const { providers, setSelectedModelAndProvider } = useSettingsStore.getState()
                const firstNonHermes = providers.find(p => p.id !== 'hermes-agent' && p.enabled && p.models.length > 0)
                if (firstNonHermes) {
                  setSelectedModelAndProvider(firstNonHermes.models[0], firstNonHermes.id)
                }
                setCurrentView('chat')
                navigate('/')
              } : switchToHermes}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 border text-sm transition-colors',
                isHermesMode
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground hover:border-accent/30'
              )}
            >
              <Bot className="w-4 h-4" />
              Hermes Agent
              {isHermesMode && <span className="ml-auto text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-sm">active</span>}
            </button>

            {isHermesMode && hermesError && (
              <p className="text-xs text-destructive px-1">{hermesError}</p>
            )}

            {/* Reveal/hide search input */}
            {!isHermesMode && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-secondary border border-border rounded-none text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}
          </div>

          {/* Session list area */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
            {isHermesMode ? (
              <>
                {/* Hermes agent sessions */}
                {hermesLoading && hermesSessions.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : hermesSessions.length === 0 && !hermesError ? (
                  <div className="text-center py-8 px-4">
                    <Bot className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No agent sessions yet</p>
                  </div>
                ) : (
                  <>
                    {hermesSessions.length > 0 && (
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-2 pt-2 pb-1">
                        Agent Sessions ({hermesSessions.length})
                      </p>
                    )}
                    {hermesSessions.map(s => (
                      <div
                        key={s.id}
                        className="group flex items-center gap-2 px-2.5 py-2 rounded-none transition-colors text-sm hover:bg-secondary/50 text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={() => loadHermesSession(s.id)}
                      >
                        <Bot className="w-3.5 h-3.5 flex-shrink-0 self-start mt-0.5 text-emerald-500/60" />
                        <div className="flex-1 min-w-0">
                          <span className="block truncate">{s.title || s.preview || 'Untitled'}</span>
                          <span className="block text-[11px] text-muted-foreground/70">
                            {s.message_count != null ? `${s.message_count} msgs` : ''}
                            {s.last_active ? ` · ${formatDate(s.last_active * 1000)}` : ''}
                          </span>
                        </div>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            try {
                              await fetch(`/api/hermes/api/sessions/${s.id}`, { method: 'DELETE' })
                              setHermesSessions(prev => prev.filter(x => x.id !== s.id))
                            } catch {}
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded-none transition-all flex-shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </>
            ) : filteredSessions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No chats yet</p>
            ) : (
              /* Regular chat sessions */
              filteredSessions.map((session) => {
                const matchInfo = getMatchInfo(session)
                return (
                <div
                  key={session.id}
                  className={cn(
                    'group flex items-center gap-2 px-2.5 py-2 rounded-none cursor-pointer transition-colors text-sm',
                    currentSessionId === session.id
                      ? 'bg-secondary text-foreground'
                      : 'hover:bg-secondary/50 text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => {
                    setCurrentView('chat')
                    navigate(getPathnameForView('chat'))
                    setCurrentSession(session.id)
                    if (searchQuery.trim()) {
                      const q = searchQuery.toLowerCase()
                      const targetMsg = session.messages.find(m => m.content.toLowerCase().includes(q))
                      setSearchHighlight(searchQuery, targetMsg?.id ?? null)
                    }
                  }}
                >
                  <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 self-start mt-0.5" />
                  {editingId === session.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={submitRename}
                      onKeyDown={(e) => e.key === 'Enter' && submitRename()}
                      autoFocus
                      className="flex-1 bg-transparent border-none outline-none text-sm"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="flex-1 min-w-0">
                      <span className="block truncate">{session.title}</span>
                      {matchInfo && (
                        <span className="block truncate text-[11px] text-muted-foreground/70 italic mt-0.5">
                          {matchInfo.snippet}
                        </span>
                      )}
                    </div>
                  )}
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {formatDate(session.updatedAt)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRename(session.id, session.title)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-secondary hover:text-foreground rounded-none transition-all"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteSession(session.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded-none transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                )
              })
            )}
          </div>

          <div className="p-3 border-t border-border space-y-1">
            <button
              onClick={() => setToolSelectorOpen(true)}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded-none transition-colors"
            >
              <Wrench className="w-4 h-4" />
              Tools & MCP
            </button>
            <button
              onClick={() => {
                const themes: any[] = ['dark', 'midnight', 'emerald', 'rose', 'violet', 'sunset', 'light']
                const currentIndex = themes.indexOf(theme)
                const nextIndex = (currentIndex + 1) % themes.length
                setTheme(themes[nextIndex])
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded-none transition-colors capitalize"
            >
              <Sun className="w-4 h-4" />
              Theme: {theme}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded-none transition-colors"
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
          </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
