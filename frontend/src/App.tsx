import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { SidebarToggle } from './components/SidebarToggle'
import { ChatWindow } from './components/ChatWindow'
import { MessageInput } from './components/MessageInput'
import { ArtifactPanel } from './components/ArtifactPanel'
import { ActivityPanel } from './components/ActivityPanel'
import { SettingsModal } from './components/SettingsModal'
import { ToolsModal } from './components/ToolsModal'
import { ModelSelector } from './components/ModelSelector'
import { useChatStore } from './stores/chatStore'
import { useSettingsStore } from './stores/settingsStore'
import { cn } from './lib/utils'

function ThemeSync() {
  const { theme } = useSettingsStore()

  useEffect(() => {
    const root = document.documentElement
    const allThemes = ['dark', 'light', 'midnight', 'emerald', 'rose', 'violet', 'sunset']
    root.classList.remove(...allThemes)

    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.classList.add(prefersDark ? 'dark' : 'light')
    } else {
      root.classList.add(theme)
    }
  }, [theme])

  return null
}

function ModelSync() {
  const { selectedModel, selectedProvider, setProviders, setSelectedModel, setSelectedProvider } = useSettingsStore()

  useEffect(() => {
    let cancelled = false

    async function loadProvidersAndModels() {
      try {
        const res = await fetch('/api/providers')
        if (!res.ok) return
        const backendProviders = await res.json()
        if (cancelled) return

        setProviders(backendProviders)

        // Fetch models for each provider
        const updatedProviders = [...backendProviders]
        for (let i = 0; i < updatedProviders.length; i++) {
          const p = updatedProviders[i]
          try {
            const modelRes = await fetch(`/api/providers/${p.id}/models`)
            if (modelRes.ok) {
              const models = await modelRes.json()
              if (Array.isArray(models) && models.length > 0) {
                updatedProviders[i] = { ...p, models }
              }
            }
          } catch {
            // ignore individual model fetch failures
          }
        }

        if (cancelled) return
        setProviders(updatedProviders)

        // Auto-select first model if none selected
        if (!selectedProvider || !selectedModel) {
          const firstWithModels = updatedProviders.find((p: any) => p.enabled && p.models && p.models.length > 0)
          if (firstWithModels) {
            setSelectedProvider(firstWithModels.id)
            setSelectedModel(firstWithModels.models[0])
          }
        }
      } catch (err) {
        console.error('[app] Failed to load providers:', err)
      }
    }

    loadProvidersAndModels()
    return () => { cancelled = true }
  }, [setProviders, setSelectedModel, setSelectedProvider])

  return null
}

function App() {
  const { sessions, currentSessionId, createSession, setCurrentSession, streaming, loadSessions } = useChatStore()

  useEffect(() => {
    loadSessions().then(() => {
      const { sessions, currentSessionId } = useChatStore.getState()
      if (sessions.length === 0 && !currentSessionId) {
        createSession().then(id => setCurrentSession(id))
      } else if (!currentSessionId && sessions.length > 0) {
        setCurrentSession(sessions[0].id)
      }
    })
  }, [loadSessions, createSession, setCurrentSession])

  const currentSession = sessions.find(s => s.id === currentSessionId)
  const isCurrentGenerating = currentSessionId ? streaming[currentSessionId]?.isGenerating ?? false : false
  const isEmpty = !currentSession || (currentSession.messages.length === 0 && !isCurrentGenerating)

  return (
    <>
      <ThemeSync />
      <ModelSync />
      <div className="fixed inset-0 flex overflow-hidden bg-background text-foreground">
        <Sidebar />
        <SidebarToggle />

        <main className={cn(
          "flex-1 flex flex-col min-w-0 overflow-hidden",
          isEmpty ? "justify-center pb-[10vh]" : ""
        )}>
          <ChatWindow />
          <MessageInput isLanding={isEmpty} />
        </main>

        <ActivityPanel />
        <ArtifactPanel />
        <SettingsModal />
        <ToolsModal />
        <ModelSelector />
      </div>
    </>
  )
}

export default App
