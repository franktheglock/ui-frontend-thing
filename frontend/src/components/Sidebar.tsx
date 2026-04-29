import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare,
  Plus,
  Trash2,
  Settings,
  ChevronLeft,
  Search,
  Wrench,
  Zap,
  Pencil,
  Moon,
  Sun,
} from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { cn, formatDate } from '../lib/utils'

export function Sidebar() {
  const { sessions, currentSessionId, createSession, setCurrentSession, deleteSession, renameSession } = useChatStore()
  const { sidebarOpen, toggleSidebar, theme, setTheme } = useSettingsStore()
  const { setSettingsOpen, setToolSelectorOpen, setSearchHighlight } = useUIStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const filteredSessions = sessions.filter(s => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    if (s.title.toLowerCase().includes(q)) return true
    // Search through message content
    return s.messages.some(m => m.content.toLowerCase().includes(q))
  })

  // For content-matched results, find the matching snippet and message ID
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
            <div className="flex items-center gap-2 text-accent">
              <Zap className="w-5 h-5" />
              <span className="font-display font-bold text-lg tracking-tight">AI Chat</span>
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
              onClick={async () => createSession()}
              className="w-full flex items-center gap-2 px-3 py-2 bg-accent text-accent-foreground rounded-none hover:bg-accent/90 transition-colors font-medium text-sm"
            >
              <Plus className="w-4 h-4" />
              New Chat
            </button>

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
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
            {filteredSessions.map((session) => {
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
                  setCurrentSession(session.id)
                  if (searchQuery.trim()) {
                    // Find the first message with the match for scrolling
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
            })}
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
