import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Send, Plus, X, Loader2, Mic, Globe2, FlaskConical, Bot, Minus, Plus as PlusSmall } from 'lucide-react'
import { Attachment, useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useChat } from '../hooks/useChat'
import { cn } from '../lib/utils'
import { getProviderIcon } from '../lib/providerIcons'
import { SiteFavicon } from './SiteFavicon'

interface PendingLocalAttachment {
  id: string
  kind: 'local-file'
  file: File
}

interface PendingServerAttachment {
  id: string
  kind: 'server-attachment'
  attachment: Attachment
}

type PendingComposerAttachment = PendingLocalAttachment | PendingServerAttachment

interface BrowserTabSummary {
  id: number
  title: string
  url: string
}

interface BrowserTabSnapshot {
  title: string
  url: string
  text?: string
  selection?: string
}

interface PendingExtensionRequest {
  resolve: (value: any) => void
  reject: (reason?: unknown) => void
  timeoutId: number
}

const reasoningEffortOptions = [
  { value: 'auto', label: 'Provider default', compactLabel: 'Auto' },
  { value: 'none', label: 'None', compactLabel: 'None' },
  { value: 'minimal', label: 'Minimal', compactLabel: 'Minimal' },
  { value: 'low', label: 'Low', compactLabel: 'Low' },
  { value: 'medium', label: 'Medium', compactLabel: 'Medium' },
  { value: 'high', label: 'High', compactLabel: 'High' },
  { value: 'xhigh', label: 'X-High', compactLabel: 'X-High' },
  { value: 'max', label: 'Max', compactLabel: 'Max' },
] as const

function generateClientId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getAttachmentName(item: PendingComposerAttachment) {
  return item.kind === 'local-file' ? item.file.name : item.attachment.name
}

function getUrlHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

function ComposerAttachmentPreview({ item, onRemove }: { item: PendingComposerAttachment, onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const file = item.kind === 'local-file' ? item.file : null
  const browserTabUrl = item.kind === 'server-attachment' && item.attachment.mimeType === 'text/markdown'
    ? item.attachment.sourceUrl
    : undefined
  const name = getAttachmentName(item)

  useEffect(() => {
    if (file?.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setPreviewUrl(null)
  }, [file])

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-secondary border border-border rounded-sm text-xs">
      {previewUrl && (
        <img src={previewUrl} alt="preview" className="w-6 h-6 object-cover rounded-sm border border-border" />
      )}
      {!previewUrl && browserTabUrl && <SiteFavicon sourceUrl={browserTabUrl} className="w-4 h-4 rounded-sm flex-shrink-0" />}
      <span className="truncate max-w-[180px]">{name}</span>
      <button
        onClick={onRemove}
        className="hover:text-destructive text-muted-foreground transition-colors flex-shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

interface SlashItem {
  label: string
  value: string
  description?: string
  meta?: string
}

export function MessageInput({ isLanding }: { isLanding?: boolean }) {
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<PendingComposerAttachment[]>([])
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [availableSkills, setAvailableSkills] = useState<any[]>([])
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashMenuIndex, setSlashMenuIndex] = useState(0)
  const [browserTabs, setBrowserTabs] = useState<BrowserTabSummary[]>([])
  const [tabSearch, setTabSearch] = useState('')
  const [tabPickerOpen, setTabPickerOpen] = useState(false)
  const [isLoadingTabs, setIsLoadingTabs] = useState(false)
  const [importingTabId, setImportingTabId] = useState<number | null>(null)
  const [extensionReady, setExtensionReady] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const inputRef = useRef('')
  const shouldKeepListeningRef = useRef(false)
  const recognitionErrorRef = useRef<string | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const dictationBaseRef = useRef('')
  const containerRef = useRef<HTMLDivElement>(null)
  const extensionRequestsRef = useRef<Map<string, PendingExtensionRequest>>(new Map())

  useEffect(() => {
    inputRef.current = input
  }, [input])

  // Load available skills
  useEffect(() => {
    fetch('/api/skills/local')
      .then(r => r.ok ? r.json() : [])
      .then((skills: any[]) => setAvailableSkills(skills))
      .catch(() => {})
  }, [])

  // Close slash menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSlashMenuOpen(false)
        setAttachmentMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    function handleExtensionMessage(event: MessageEvent) {
      if (event.source !== window) return
      const data = event.data
      if (!data || data.source !== 'ai-chat-ui-extension') return

       if (data.type === 'READY' || data.type === 'PONG') {
        setExtensionReady(true)
      }

      const requestId = typeof data.requestId === 'string' ? data.requestId : null
      if (!requestId) return

      const pending = extensionRequestsRef.current.get(requestId)
      if (!pending) return

      window.clearTimeout(pending.timeoutId)
      extensionRequestsRef.current.delete(requestId)

      if (data.error) {
        pending.reject(new Error(String(data.error)))
        return
      }

      pending.resolve(data.payload)
    }

    window.addEventListener('message', handleExtensionMessage)
    return () => {
      window.removeEventListener('message', handleExtensionMessage)
      extensionRequestsRef.current.forEach((pending) => {
        window.clearTimeout(pending.timeoutId)
        pending.reject(new Error('Browser tab request cancelled'))
      })
      extensionRequestsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const requestId = generateClientId()
    window.postMessage({ source: 'ai-chat-ui', type: 'PING', requestId, payload: {} }, '*')
  }, [])

  const { currentSessionId, streaming, sessions } = useChatStore()
  const isCurrentGenerating = currentSessionId ? streaming[currentSessionId]?.isGenerating ?? false : false
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const activeSkill = currentSession?.activeSkill
  const {
    selectedModel,
    selectedProvider,
    providers,
    reasoningEffort,
    deepResearch,
    multiAgentEnabled,
    maxSubagents,
    setReasoningEffort,
    setDeepResearch,
    setMultiAgentEnabled,
    setMaxSubagents,
  } = useSettingsStore()
  const { setModelSelectorOpen } = useUIStore()
  const { sendMessage } = useChat()

  const reasoningEffortIndex = useMemo(
    () => Math.max(0, reasoningEffortOptions.findIndex((option) => option.value === reasoningEffort)),
    [reasoningEffort]
  )

  const requestExtension = useCallback((type: string, payload?: Record<string, unknown>) => {
    return new Promise<any>((resolve, reject) => {
      const requestId = generateClientId()
      const timeoutId = window.setTimeout(() => {
        extensionRequestsRef.current.delete(requestId)
        reject(new Error(extensionReady
          ? 'Browser extension bridge did not respond. Reload the extension and the app tab, then try again.'
          : 'Browser extension not detected in this tab. Reload the extension and refresh the app tab to import tabs.'))
      }, 5000)

      extensionRequestsRef.current.set(requestId, { resolve, reject, timeoutId })
      window.postMessage({
        source: 'ai-chat-ui',
        type,
        requestId,
        payload: payload || {},
      }, '*')
    })
  }, [extensionReady])

  const sessionStats = useMemo(() => {
    if (!currentSession) return { cost: 0, input: 0, output: 0, total: 0, isGathering: false }
    
    const stats = currentSession.messages.reduce((acc, m) => {
      const info = m.generationInfo
      if (!info) return acc
      return {
        cost: acc.cost + (info.totalCost || 0),
        input: acc.input + (info.promptTokens || 0),
        output: acc.output + (info.completionTokens || 0),
        total: acc.total + (info.tokensUsed || info.completionTokens || 0),
        isGathering: acc.isGathering || !!info.isGatheringCost
      }
    }, { cost: 0, input: 0, output: 0, total: 0, isGathering: false })

    const activeInfo = currentSessionId ? streaming[currentSessionId]?.generationInfo : null
    if (activeInfo) {
      stats.cost += activeInfo.totalCost || 0
      stats.input += activeInfo.promptTokens || 0
      stats.output += activeInfo.completionTokens || 0
      stats.total += activeInfo.tokensUsed || activeInfo.completionTokens || 0
      if (activeInfo.isGatheringCost) stats.isGathering = true
    }

    return stats
  }, [currentSession, currentSessionId, streaming])

  const filteredBrowserTabs = useMemo(() => {
    const query = tabSearch.trim().toLowerCase()
    if (!query) return browserTabs

    return browserTabs.filter((tab) => {
      const title = (tab.title || '').toLowerCase()
      const url = (tab.url || '').toLowerCase()
      const hostname = getUrlHost(tab.url).toLowerCase()
      return title.includes(query) || url.includes(query) || hostname.includes(query)
    })
  }, [browserTabs, tabSearch])

  const slashMenuItems = useMemo(() => {
    if (!input.startsWith('/')) {
      return []
    }

    const trimmed = input.slice(1) // remove leading /
    const spaceIdx = trimmed.indexOf(' ')
    const command = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
    const query = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim().toLowerCase()

    let items: SlashItem[] = []

    if (spaceIdx === -1) {
      // Showing commands
      const commands: SlashItem[] = [
        { label: '/skill', value: '/skill ', description: 'Load a skill' },
        { label: '/model', value: '/model ', description: 'Change model' },
      ]
      items = commands.filter(c => c.label.includes(command.toLowerCase()))
    } else if (command === 'skill') {
      items = availableSkills
        .filter(s => s.name.toLowerCase().includes(query) || s.manifest?.description?.toLowerCase().includes(query))
        .map(s => ({ 
          label: s.name, 
          value: `/skill ${s.name}`, 
          description: s.manifest?.description 
        }))
    } else if (command === 'model') {
      // Collect all potential models from all providers
      const allModelItems: SlashItem[] = []
      const seenModels = new Set<string>()

      providers.forEach(p => {
        (p.models || []).forEach((m: string) => {
          const providerId = p.id.toLowerCase()
          const providerName = p.name.toLowerCase()
          const modelName = m.toLowerCase()
          const qualifiedModel = `${p.id}/${m}`.toLowerCase()
          
          let matches = !query
          if (query) {
            const lowerQuery = query.toLowerCase()
            // If query ends in /, treat as strict provider filter
            if (lowerQuery.endsWith('/')) {
              const pFilter = lowerQuery.slice(0, -1)
              matches = providerId === pFilter || providerName.includes(pFilter)
            } else {
              matches = modelName.includes(lowerQuery) || 
                        qualifiedModel.includes(lowerQuery) ||
                        providerId.includes(lowerQuery) ||
                        providerName.includes(lowerQuery) ||
                        (lowerQuery.includes(' ') && qualifiedModel.includes(lowerQuery.replace(' ', '/')))
            }
          }

          if (matches) {
            const uniqueKey = `${p.id}:${m}`
            if (!seenModels.has(uniqueKey)) {
              seenModels.add(uniqueKey)
              allModelItems.push({
                label: m,
                value: `/model ${p.id}/${m}`,
                meta: p.name,
              })
            }
          }
        })
      })

      // If we have a query, prioritize model name matches
      if (query) {
        items = allModelItems.sort((a, b) => {
          const aMatch = a.label.toLowerCase().includes(query)
          const bMatch = b.label.toLowerCase().includes(query)
          if (aMatch && !bMatch) return -1
          if (!aMatch && bMatch) return 1
          return 0
        })
      } else {
        items = allModelItems
      }
    }

    return items
  }, [input, availableSkills, providers])

  useEffect(() => {
    if (!input.startsWith('/')) {
      setSlashMenuOpen(false)
      setSlashMenuIndex(0)
      return
    }

    if (slashMenuItems.length > 0) {
      setSlashMenuOpen(true)
      setSlashMenuIndex(prev => Math.min(prev, slashMenuItems.length - 1))
    } else {
      setSlashMenuOpen(false)
      setSlashMenuIndex(0)
    }
  }, [input, slashMenuItems])

  // --------------------------------------------------------------------------
  // Speech-to-Text (Web Speech API)
  // --------------------------------------------------------------------------
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported in this browser.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      console.log('Speech recognition started')
      recognitionErrorRef.current = null
      dictationBaseRef.current = inputRef.current.replace(/\s*\.\.\.$/, '').trim()
      setIsListening(true)
    }

    recognition.onresult = (event: any) => {
      let finalTranscript = ''
      let interimTranscript = ''

      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interimTranscript += transcript
        }
      }
      
      if (finalTranscript || interimTranscript) {
        const dictatedText = `${finalTranscript}${interimTranscript}`.trim()
        const base = dictationBaseRef.current
        const nextValue = dictatedText
          ? `${base} ${dictatedText}`.trim()
          : base

        setInput(interimTranscript ? `${nextValue}...` : nextValue)
      }
    }

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      recognitionErrorRef.current = event.error || 'unknown'
      if (event.error === 'not-allowed') {
        alert('Microphone access denied. Please check your browser permissions.')
      } else if (event.error === 'network') {
        shouldKeepListeningRef.current = false
        alert('Voice input could not reach the browser speech service. Check your browser network access, then try again.')
      }
      setIsListening(false)
    }

    recognition.onend = () => {
      console.log('Speech recognition ended')
      const shouldRestart = shouldKeepListeningRef.current && !recognitionErrorRef.current
      if (shouldRestart) {
        try {
          dictationBaseRef.current = inputRef.current.replace(/\s*\.\.\.$/, '').trim()
          recognition.start()
          return
        } catch (err) {
          console.error('Failed to restart recognition:', err)
        }
      }
      setIsListening(false)
    }

    recognitionRef.current = recognition

    return () => {
      shouldKeepListeningRef.current = false
      micStreamRef.current?.getTracks().forEach(track => track.stop())
      micStreamRef.current = null
      recognition.stop()
    }
  }, [])

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser.')
      return
    }
    if (isListening) {
      shouldKeepListeningRef.current = false
      recognitionRef.current.stop()
    } else {
      setInput(prev => prev.replace(/\s*\.\.\.$/, ''))
      shouldKeepListeningRef.current = true
      recognitionErrorRef.current = null

      ;(async () => {
        try {
          if (!micStreamRef.current) {
            micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
          }
          recognitionRef.current.start()
        } catch (err: any) {
          shouldKeepListeningRef.current = false
          console.error('Failed to start recognition:', err)
          const message = err?.name === 'NotAllowedError'
            ? 'Microphone access denied. Please check your browser permissions.'
            : 'Voice input could not start. Check microphone permissions and browser speech support, then try again.'
          alert(message)
          setIsListening(false)
        }
      })()
    }
  }, [isListening])

  const openTabPicker = useCallback(async () => {
    setIsLoadingTabs(true)
    try {
      const tabs = await requestExtension('LIST_TABS') as BrowserTabSummary[]
      const visibleTabs = (Array.isArray(tabs) ? tabs : []).filter(tab => tab.url !== window.location.href)
      setBrowserTabs(visibleTabs)
      setTabSearch('')
      setAttachmentMenuOpen(false)
      setTabPickerOpen(true)
    } catch (error) {
      console.error('Tab listing error:', error)
      alert(error instanceof Error ? error.message : 'Failed to fetch browser tabs.')
    } finally {
      setIsLoadingTabs(false)
    }
  }, [requestExtension])

  const importBrowserTab = useCallback(async (tabId: number) => {
    setImportingTabId(tabId)
    try {
      const snapshot = await requestExtension('CAPTURE_TAB', { tabId }) as BrowserTabSnapshot
      const response = await fetch('/api/upload/browser-tab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Failed to store browser tab context.')
      }

      const data = await response.json()
      const attachments = Array.isArray(data.attachments) ? data.attachments as Attachment[] : []
      setPendingAttachments(prev => [
        ...prev,
        ...attachments.map(attachment => ({
          id: attachment.id,
          kind: 'server-attachment' as const,
          attachment,
        })),
      ])
      setTabPickerOpen(false)
    } catch (error) {
      console.error('Tab import error:', error)
      alert(error instanceof Error ? error.message : 'Failed to import browser tab.')
    } finally {
      setImportingTabId(null)
    }
  }, [requestExtension])

  // --------------------------------------------------------------------------
  // Message sending
  // --------------------------------------------------------------------------
  const handleSubmit = useCallback(async (overrideContent?: string) => {
    const content = (overrideContent || input).trim()
    if (!content && pendingAttachments.length === 0) return
    if (isCurrentGenerating) return

    setSlashMenuOpen(false)
    const localFiles = pendingAttachments.filter((item): item is PendingLocalAttachment => item.kind === 'local-file')
    const existingAttachments = pendingAttachments
      .filter((item): item is PendingServerAttachment => item.kind === 'server-attachment')
      .map(item => item.attachment)
    let attachments: Attachment[] = [...existingAttachments]

    if (localFiles.length > 0) {
      setIsUploading(true)
      const formData = new FormData()
      localFiles.forEach(item => formData.append('files', item.file))

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })
        const data = await response.json()
        attachments = [...attachments, ...(Array.isArray(data.attachments) ? data.attachments : [])]
      } catch (error) {
        console.error('Upload error:', error)
      } finally {
        setIsUploading(false)
      }
    }

    setInput('')
    setPendingAttachments([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.focus()
    }

    await sendMessage(content, attachments)
  }, [input, pendingAttachments, isCurrentGenerating, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!slashMenuOpen) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
      return
    }

    // Slash menu is open - handle navigation
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSlashMenuIndex(prev => (prev + 1) % slashMenuItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSlashMenuIndex(prev => (prev - 1 + slashMenuItems.length) % slashMenuItems.length)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const item = slashMenuItems[slashMenuIndex]
      if (item) {
        setInput(item.value)
        setSlashMenuOpen(false)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = slashMenuItems[slashMenuIndex]
      if (item) {
        setInput(item.value)
        setSlashMenuOpen(false)
        // Auto-submit slash commands like /model and /skill on selection
        setTimeout(() => {
          handleSubmit(item.value)
        }, 10)
      }
    } else if (e.key === 'Escape') {
      setSlashMenuOpen(false)
    }
  }

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget
    target.style.height = 'auto'
    target.style.height = `${target.scrollHeight}px`
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData && e.clipboardData.items) {
      const pastedFiles: PendingLocalAttachment[] = []
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        const item = e.clipboardData.items[i]
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            const ext = item.type.split('/')[1] || 'png'
            const newFile = new File([file], `pasted-image-${Date.now()}-${i}.${ext}`, { type: file.type })
            pastedFiles.push({ id: generateClientId(), kind: 'local-file', file: newFile })
          }
        }
      }
      if (pastedFiles.length > 0) {
        setPendingAttachments(prev => [...prev, ...pastedFiles])
      }
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPendingAttachments(prev => [
        ...prev,
        ...Array.from(e.target.files || []).map(file => ({
          id: generateClientId(),
          kind: 'local-file' as const,
          file,
        })),
      ])
      e.target.value = ''
    }
  }

  const canSubmit = !isCurrentGenerating && !isUploading && (input.trim() || pendingAttachments.length > 0)

  // Model display name (truncate if too long)
  const modelName = selectedModel
    ? selectedModel.split('/').pop() || selectedModel
    : 'Select model'

  return (
    <div className={cn(
      "absolute bottom-0 left-0 right-0 z-20 px-4 pb-[env(safe-area-inset-bottom)]",
      isLanding ? "bg-transparent pb-[max(env(safe-area-inset-bottom),3rem)]" : "pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-2"
    )}>
      <div className="max-w-3xl mx-auto space-y-3">
        {activeSkill && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border border-accent/20 rounded-sm text-xs">
            <span className="text-accent font-medium">Skill active:</span>
            <span className="text-foreground">{activeSkill}</span>
            <button
              onClick={() => useChatStore.getState().setActiveSkill(currentSessionId!, undefined)}
              className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        {tabPickerOpen && (
          <div className="border border-border bg-card/95 backdrop-blur-sm rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
              <div>
                <p className="text-sm font-medium">Add Browser Tab</p>
                <p className="text-xs text-muted-foreground">Choose a tab to snapshot into chat context.</p>
              </div>
              <button
                onClick={() => {
                  setTabPickerOpen(false)
                  setTabSearch('')
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-3 py-2 border-b border-border/60">
              <input
                value={tabSearch}
                onChange={(e) => setTabSearch(e.target.value)}
                placeholder="Search tabs by title or URL"
                className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-accent/40"
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-2 space-y-1">
              {filteredBrowserTabs.length > 0 ? filteredBrowserTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => importBrowserTab(tab.id)}
                  disabled={importingTabId !== null}
                  className="w-full text-left px-3 py-2 rounded-lg border border-transparent hover:border-border hover:bg-secondary/60 transition-colors disabled:opacity-60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-2">
                      <SiteFavicon sourceUrl={tab.url} className="w-4 h-4 rounded-sm flex-shrink-0" />
                      <div className="min-w-0">
                      <p className="text-sm truncate">{tab.title || 'Untitled tab'}</p>
                      <p className="text-xs text-muted-foreground truncate">{getUrlHost(tab.url)}</p>
                      </div>
                    </div>
                    {importingTabId === tab.id ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" /> : <Globe2 className="w-4 h-4 text-accent flex-shrink-0" />}
                  </div>
                </button>
              )) : (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  {browserTabs.length > 0
                    ? 'No tabs match that search.'
                    : 'No importable tabs found. Open another tab, or install the companion extension if it is missing.'}
                </div>
              )}
            </div>
          </div>
        )}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingAttachments.map((item) => (
              <ComposerAttachmentPreview
                key={item.id}
                item={item}
                onRemove={() => setPendingAttachments(prev => prev.filter((attachment) => attachment.id !== item.id))}
              />
            ))}
          </div>
        )}

        {/* Floating input bar */}
        <div
          ref={containerRef}
          className={cn(
            "flex flex-col gap-1.5",
            "bg-card/80 backdrop-blur-xl",
            "border border-border/60",
            "shadow-[0_0_40px_-12px_rgba(0,0,0,0.4)]",
            "rounded-2xl",
            "px-3 py-2.5",
            "transition-all duration-300",
            "focus-within:border-accent/40 focus-within:shadow-[0_0_50px_-10px_rgba(0,0,0,0.5)]"
          )}
        >
          {/* Top row: textarea with slash menu */}
          <div className="flex items-end gap-1.5 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              onPaste={handlePaste}
              placeholder="Ask anything (type / for commands)"
              className="flex-1 px-1.5 py-1 bg-transparent text-sm placeholder:text-muted-foreground/60 focus:outline-none resize-none min-h-[28px] leading-normal"
            />
            {slashMenuOpen && slashMenuItems.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1.5 bg-popover border border-border rounded-none shadow-2xl max-h-[240px] overflow-y-auto z-[9999]">
                {slashMenuItems[0]?.description !== undefined ? (
                  <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border/50">Commands</div>
                ) : slashMenuItems[0]?.meta !== undefined ? (
                  <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border/50">Models</div>
                ) : (
                  <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border/50">Skills</div>
                )}
                {slashMenuItems.map((item, idx) => (
                  <button
                    key={item.value}
                    ref={el => {
                      if (idx === slashMenuIndex && el) {
                        el.scrollIntoView({ block: 'nearest' })
                      }
                    }}
                    onClick={() => {
                      setInput(item.value)
                      setSlashMenuOpen(false)
                      textareaRef.current?.focus()
                      setTimeout(() => {
                        handleSubmit(item.value)
                      }, 10)
                    }}
                    onMouseEnter={() => setSlashMenuIndex(idx)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2",
                      idx === slashMenuIndex ? "bg-accent/10 text-accent" : "hover:bg-secondary/50"
                    )}
                  >
                    {item.description ? (
                      <>
                        <span className="font-mono text-xs">{item.label}</span>
                        <span className="text-muted-foreground text-xs">{item.description}</span>
                      </>
                    ) : item.meta ? (
                      <>
                        {(() => {
                          const Icon = getProviderIcon(item.value.split(' ')[1])
                          return <Icon size={16} className="flex-shrink-0 opacity-60" />
                        })()}
                        <span className="flex-1 truncate">{item.label}</span>
                        <span className="text-[10px] text-muted-foreground">{item.meta}</span>
                      </>
                    ) : (
                      <span className="truncate">{item.label}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bottom action row */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              {/* File upload */}
              <div className="relative">
                <button
                  onClick={() => setAttachmentMenuOpen(prev => !prev)}
                  className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-accent/5"
                  title="Add attachment or browser context"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {attachmentMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-popover/95 shadow-2xl backdrop-blur-sm z-30">
                    <button
                      onClick={() => {
                        setAttachmentMenuOpen(false)
                        fileInputRef.current?.click()
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-secondary/60 transition-colors"
                    >
                      <Plus className="w-4 h-4 text-accent" />
                      <span>Upload file</span>
                    </button>
                    <button
                      onClick={() => openTabPicker()}
                      disabled={isLoadingTabs || isUploading}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-secondary/60 transition-colors disabled:opacity-50"
                    >
                      {isLoadingTabs ? <Loader2 className="w-4 h-4 animate-spin text-accent" /> : <Globe2 className="w-4 h-4 text-accent" />}
                      <span>Add browser tab</span>
                    </button>
                    <div className="border-t border-border/70 px-3 py-3">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div>
                          <div className="text-xs font-medium text-foreground">Reasoning effort</div>
                          <div className="text-[11px] text-muted-foreground">Applies to the next message</div>
                        </div>
                        <span className="inline-flex min-h-6 min-w-[112px] flex-shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-border/70 bg-secondary/70 px-2 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide leading-none text-accent">
                          {reasoningEffortOptions[reasoningEffortIndex]?.label ?? 'Auto'}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={reasoningEffortOptions.length - 1}
                        step={1}
                        value={reasoningEffortIndex}
                        onChange={(e) => {
                          const nextIndex = Number(e.target.value)
                          const nextOption = reasoningEffortOptions[nextIndex]
                          if (nextOption) {
                            setReasoningEffort(nextOption.value)
                          }
                        }}
                        className="w-full accent-[var(--accent)]"
                        aria-label="Reasoning effort"
                      />
                      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Auto</span>
                        <span>Max</span>
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-1.5">
                        {reasoningEffortOptions.map((option, index) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setReasoningEffort(option.value)}
                            className={cn(
                              'rounded-md border px-1.5 py-1 text-[10px] font-medium transition-colors',
                              index === reasoningEffortIndex
                                ? 'border-accent/40 bg-accent/10 text-accent'
                                : 'border-border/60 text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                            )}
                          >
                            {option.compactLabel}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-border/70 px-3 py-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <FlaskConical className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground">Deep Research</div>
                            <div className="text-[11px] text-muted-foreground">Thorough multi-step research before answering</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDeepResearch(!deepResearch)}
                          className={cn(
                            'rounded-md border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors',
                            deepResearch
                              ? 'border-accent/40 bg-accent/10 text-accent'
                              : 'border-border/60 text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                          )}
                        >
                          {deepResearch ? 'On' : 'Off'}
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <Bot className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground">Multi-Agent</div>
                            <div className="text-[11px] text-muted-foreground">Allow the model to delegate scoped research to subagents</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setMultiAgentEnabled(!multiAgentEnabled)}
                          className={cn(
                            'rounded-md border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors',
                            multiAgentEnabled
                              ? 'border-accent/40 bg-accent/10 text-accent'
                              : 'border-border/60 text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                          )}
                        >
                          {multiAgentEnabled ? 'On' : 'Off'}
                        </button>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-medium text-foreground">Max subagents</div>
                            <div className="text-[10px] text-muted-foreground">Concurrent subagents allowed on the next turn</div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setMaxSubagents(Math.max(1, maxSubagents - 1))}
                              className="rounded-md border border-border/60 p-1 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                              aria-label="Decrease max subagents"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="inline-flex min-w-8 items-center justify-center rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs font-medium text-foreground">
                              {maxSubagents}
                            </span>
                            <button
                              type="button"
                              onClick={() => setMaxSubagents(Math.min(8, maxSubagents + 1))}
                              className="rounded-md border border-border/60 p-1 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                              aria-label="Increase max subagents"
                            >
                              <PlusSmall className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />


              {/* Model selector pill */}
              {deepResearch && (
                <button
                  type="button"
                  onClick={() => setDeepResearch(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/10 text-xs text-accent transition-colors border border-accent/20 hover:bg-accent/15"
                  title="Disable deep research for the next message"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  <span>Deep Research</span>
                </button>
              )}

              {multiAgentEnabled && (
                <button
                  type="button"
                  onClick={() => setMultiAgentEnabled(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/10 text-xs text-accent transition-colors border border-accent/20 hover:bg-accent/15"
                  title="Disable multi-agent mode for the next message"
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>Agents {maxSubagents}</span>
                </button>
              )}

              <button
                onClick={() => setModelSelectorOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/60 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border/40"
              >
                {(() => {
                  const Icon = getProviderIcon(`${selectedProvider}/${selectedModel}`)
                  return <Icon size={16} className="text-accent/80" />
                })()}
                <span className="truncate max-w-[100px]">{modelName}</span>
              </button>

              {/* Session Cost Indicator */}
              {currentSession && (
                <div className="relative">
                  <div className="group relative flex items-center justify-center w-8 h-8 cursor-pointer">
                    <svg width="28" height="28" viewBox="0 0 28 28" className="transform -rotate-90">
                      <circle
                        cx="14"
                        cy="14"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        fill="transparent"
                        className="text-muted/50"
                      />
                      {(() => {
                        const limit = 0.50
                        const percent = Math.min((sessionStats.cost / limit) * 100, 100)
                        const colorClass = percent < 10 ? 'text-emerald-500' : 
                                         percent < 40 ? 'text-amber-500' :
                                         percent < 80 ? 'text-orange-500' : 'text-rose-500'
                        const circumference = 2 * Math.PI * 10
                        const offset = circumference - (percent / 100) * circumference
                        
                        return (
                          <circle
                            cx="14"
                            cy="14"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            fill="transparent"
                            strokeDasharray={circumference}
                            style={{ strokeDashoffset: offset }}
                            className={cn("transition-all duration-1000 ease-out", colorClass)}
                          />
                        )
                      })()}
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 rounded-full">
                      <span className="text-[10px] font-bold text-accent">$</span>
                    </div>

                    {/* Custom Tooltip */}
                    <div className="absolute bottom-full mb-3 right-0 opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 transform translate-y-2 group-hover:translate-y-0 z-50">
                      <div className="bg-popover border border-border rounded-sm shadow-xl p-3 min-w-[180px] backdrop-blur-md bg-opacity-90">
                        <div className="flex items-center gap-2 mb-2 border-b border-border pb-2">
                          <div className="w-2 h-2 rounded-full bg-accent" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-foreground">Session Metrics</span>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-muted-foreground">Input Tokens</span>
                            <span className="font-mono text-foreground font-medium">{sessionStats.input.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-muted-foreground">Output Tokens</span>
                            <span className="font-mono text-foreground font-medium">{sessionStats.output.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-muted-foreground">Total Tokens</span>
                            <span className="font-mono text-foreground font-medium">{sessionStats.total.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center pt-1 border-t border-border mt-1">
                            <span className="text-[10px] font-bold uppercase text-accent">Total Cost</span>
                            <span className="text-[12px] font-mono font-bold text-accent">
                              {sessionStats.isGathering ? 'Gathering cost...' : `$${sessionStats.cost.toFixed(6)}`}
                            </span>
                          </div>
                        </div>
                        {/* Tooltip Arrow */}
                        <div className="absolute top-full right-3 -translate-y-px w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-border" />
                        <div className="absolute top-full right-3 -translate-y-[2px] w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-popover" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Mic */}
              <button
                onClick={toggleListening}
                className={cn(
                  "p-2.5 rounded-full transition-all",
                  isListening
                    ? "text-accent bg-accent/10 ring-2 ring-accent/30 animate-pulse"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/5"
                )}
                title={isListening ? 'Stop listening' : 'Voice input'}
              >
                <Mic className="w-4 h-4" />
              </button>

              {/* Send */}
              <button
                onClick={() => handleSubmit()}
                disabled={!canSubmit}
                className={cn(
                  'p-2.5 rounded-full transition-all flex-shrink-0',
                  canSubmit
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                )}
              >
                {isUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Landing page extras */}
        {isLanding && (
          <div className="flex items-center justify-center gap-4 text-[10px] uppercase tracking-widest text-muted-foreground/50 font-bold">
            <span>Fast</span>
            <div className="w-1 h-1 rounded-full bg-border" />
            <span>Extensible</span>
            <div className="w-1 h-1 rounded-full bg-border" />
            <span>Native</span>
          </div>
        )}
      </div>
    </div>
  )
}
