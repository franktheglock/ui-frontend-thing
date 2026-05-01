import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Send, Plus, X, Loader2, Mic, Zap, Hash } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useChat } from '../hooks/useChat'
import { cn } from '../lib/utils'

function FilePreview({ file, onRemove }: { file: File, onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
  }, [file])

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-secondary border border-border rounded-sm text-xs">
      {previewUrl && (
        <img src={previewUrl} alt="preview" className="w-6 h-6 object-cover rounded-sm border border-border" />
      )}
      <span className="truncate max-w-[150px]">{file.name}</span>
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
  const [files, setFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [availableSkills, setAvailableSkills] = useState<any[]>([])
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashMenuIndex, setSlashMenuIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const { currentSessionId, streaming, sessions } = useChatStore()
  const isCurrentGenerating = currentSessionId ? streaming[currentSessionId]?.isGenerating ?? false : false
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const activeSkill = currentSession?.activeSkill
  const { selectedModel, providers } = useSettingsStore()
  const { setModelSelectorOpen } = useUIStore()
  const { sendMessage } = useChat()

  const sessionStats = useMemo(() => {
    if (!currentSession) return { cost: 0, input: 0, output: 0, total: 0 }
    
    // Sum from finished messages
    const stats = currentSession.messages.reduce((acc, m) => {
      const info = m.generationInfo
      if (!info) return acc
      return {
        cost: acc.cost + (info.totalCost || 0),
        input: acc.input + (info.promptTokens || 0),
        output: acc.output + (info.completionTokens || 0),
        total: acc.total + (info.tokensUsed || info.completionTokens || 0),
      }
    }, { cost: 0, input: 0, output: 0, total: 0 })

    // Add current streaming stats if any
    const activeInfo = currentSessionId ? streaming[currentSessionId]?.generationInfo : null
    if (activeInfo) {
      stats.cost += activeInfo.totalCost || 0
      stats.input += activeInfo.promptTokens || 0
      stats.output += activeInfo.completionTokens || 0
      stats.total += activeInfo.tokensUsed || activeInfo.completionTokens || 0
    }

    return stats
  }, [currentSession, currentSessionId, streaming])

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
          
          const matches = !query || 
            modelName.includes(query) || 
            qualifiedModel.includes(query) ||
            providerId.includes(query) ||
            providerName.includes(query)

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
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      console.log('Speech recognition started')
      setIsListening(true)
    }

    recognition.onresult = (event: any) => {
      let finalTranscript = ''
      let interimTranscript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interimTranscript += transcript
        }
      }
      
      if (finalTranscript || interimTranscript) {
        setInput(prev => {
          const base = prev.replace(/\s*\.\.\.$/, '')
          if (finalTranscript) {
            return (base + ' ' + finalTranscript).trim()
          }
          return (base + ' ' + interimTranscript).trim() + '...'
        })
      }
    }

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      if (event.error === 'not-allowed') {
        alert('Microphone access denied. Please check your browser permissions.')
      }
      setIsListening(false)
    }

    recognition.onend = () => {
      console.log('Speech recognition ended')
      setIsListening(false)
    }

    recognitionRef.current = recognition
  }, [])

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser.')
      return
    }
    if (isListening) {
      recognitionRef.current.stop()
    } else {
      setInput(prev => prev.replace(/\s*\.\.\.$/, ''))
      try {
        recognitionRef.current.start()
      } catch (err) {
        console.error('Failed to start recognition:', err)
        // If it's already started, just sync the state
        setIsListening(true)
      }
    }
  }, [isListening])

  // --------------------------------------------------------------------------
  // Message sending
  // --------------------------------------------------------------------------
  const handleSubmit = useCallback(async (overrideContent?: string) => {
    const content = (overrideContent || input).trim()
    if (!content && files.length === 0) return
    if (isCurrentGenerating) return

    setSlashMenuOpen(false)
    let attachments: any[] = []

    if (files.length > 0) {
      setIsUploading(true)
      const formData = new FormData()
      files.forEach(file => formData.append('files', file))

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })
        const data = await response.json()
        attachments = data.attachments
      } catch (error) {
        console.error('Upload error:', error)
      } finally {
        setIsUploading(false)
      }
    }

    setInput('')
    setFiles([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    await sendMessage(content, attachments)
  }, [input, files, isCurrentGenerating, currentSessionId, sendMessage])

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
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData && e.clipboardData.items) {
      const pastedFiles: File[] = []
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        const item = e.clipboardData.items[i]
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            const ext = item.type.split('/')[1] || 'png'
            const newFile = new File([file], `pasted-image-${Date.now()}-${i}.${ext}`, { type: file.type })
            pastedFiles.push(newFile)
          }
        }
      }
      if (pastedFiles.length > 0) {
        setFiles(prev => [...prev, ...pastedFiles])
      }
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files))
    }
  }

  const canSubmit = !isCurrentGenerating && !isUploading && (input.trim() || files.length > 0)

  // Model display name (truncate if too long)
  const modelName = selectedModel
    ? selectedModel.split('/').pop() || selectedModel
    : 'Select model'

  return (
    <div className={cn(
      "flex-shrink-0 px-4 pb-[env(safe-area-inset-bottom)]",
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
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <FilePreview
                key={index}
                file={file}
                onRemove={() => setFiles(files.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}

        {/* Floating input bar */}
        <div
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
          <div ref={containerRef} className="flex items-end gap-1.5 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              onPaste={handlePaste}
              placeholder="Ask anything (type / for commands)"
              className="flex-1 px-1.5 py-1 bg-transparent text-sm placeholder:text-muted-foreground/60 focus:outline-none resize-none min-h-[28px] max-h-[200px] overflow-y-auto leading-normal"
              disabled={isCurrentGenerating || isUploading}
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
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-accent/5"
              >
                <Plus className="w-4 h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />


              {/* Model selector pill */}
              <button
                onClick={() => setModelSelectorOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/60 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border/40"
              >
                <Zap className="w-3 h-3" />
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
                            <span className="text-[12px] font-mono font-bold text-accent">${sessionStats.cost.toFixed(6)}</span>
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
