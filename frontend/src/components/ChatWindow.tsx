import { useRef, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChatStore, Message, ToolCall, ToolResult, GenerationInfo as GenInfo } from '../stores/chatStore'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { MessageBubble } from './MessageBubble'
import { Globe, Terminal, Link2, ChevronDown, ChevronRight, Wrench, Copy } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { GenerationInfo } from './GenerationInfo'
import { useChat } from '../hooks/useChat'
import { cn } from '../lib/utils'
import { getActivitySublabel } from '../lib/toolDisplay'
import { getProviderIcon } from '../lib/providerIcons'

type RenderItem = 
  | { type: 'message', message: Message, aggregatedGenInfo?: GenInfo, onRegenerate?: () => void, versionInfo?: { current: number, total: number, onPrev: () => void, onNext: () => void } }
  | { type: 'aggregated_tools', toolType: string, calls: ToolCall[], results: ToolResult[], turnId: number, isFirstInTurn: boolean, key: string }
  | { type: 'streaming_preview', content: string, thinking: string, activeCalls: ToolCall[], activeToolResults: ToolResult[], generationInfo?: GenInfo }

export function ChatWindow() {
  const { sessions, currentSessionId, streaming } = useChatStore()
  const { searchHighlight, highlightMessageId, setSearchHighlight } = useUIStore()
  const { toolDisplayMode, selectedProvider, selectedModel } = useSettingsStore()
  const { regenerateMessage } = useChat()
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const messages = currentSession?.messages || []

  const [turnVersions, setTurnVersions] = useState<Record<string, number>>({})

  useEffect(() => {
    setTurnVersions({})
  }, [currentSessionId])

  const streamState = currentSessionId ? streaming[currentSessionId] : null
  const isCurrentStreaming = streamState?.isGenerating ?? false
  const streamingContent = streamState?.content ?? ''
  const streamingThinking = streamState?.thinking ?? ''
  const activeToolCalls = streamState?.toolCalls ?? []
  const activeToolResults = streamState?.toolResults ?? []

  const getToolType = (name: string) => {
    if (name === 'web_search') return 'search'
    if (name === 'read_url' || name === 'read_browser_page') return 'browse'
    if (name === 'python' || name === 'terminal') return 'code'
    return name
  }

  const renderItems = useMemo(() => {
    const items: RenderItem[] = []
    
    // 1. Group messages into Turns and Versions
    const turns: { user: Message | null, assistantVersions: Message[][] }[] = []
    let currentTurn: { user: Message | null, assistantVersions: Message[][] } = { user: null, assistantVersions: [[]] }

    messages.forEach((msg) => {
      if (msg.role === 'user') {
        if (currentTurn.user || currentTurn.assistantVersions[0].length > 0) turns.push(currentTurn)
        currentTurn = { user: msg, assistantVersions: [[]] }
      } else if (msg.role === 'assistant') {
        const currentVersionIdx = currentTurn.assistantVersions.length - 1
        const currentVersion = currentTurn.assistantVersions[currentVersionIdx]
        const lastMsg = currentVersion[currentVersion.length - 1]
        
        const isNewAttemptStarted = lastMsg && lastMsg.metadata?.active === false && msg.metadata?.active === true
        const isResponseIdChange = lastMsg && msg.responseId && lastMsg.responseId && msg.responseId !== lastMsg.responseId

        if (isNewAttemptStarted || isResponseIdChange) {
          currentTurn.assistantVersions.push([msg])
        } else {
          currentVersion.push(msg)
        }
      }
    })
    if (currentTurn.user || currentTurn.assistantVersions[0].length > 0 || (isCurrentStreaming && turns.length === 0)) {
      turns.push(currentTurn)
    }

    // 2. Process each turn into RenderItems
    turns.forEach((turn, turnIdx) => {
      if (turn.user) items.push({ type: 'message', message: turn.user })

      const turnKey = turn.user?.id || `turn-${turnIdx}`
      const isLastTurn = turnIdx === turns.length - 1
      
      const activeVersionIdx = turnVersions[turnKey] ?? (turn.assistantVersions.length - 1)
      const assistantMessages = turn.assistantVersions[activeVersionIdx] || []

      const isActuallyStreamingThisTurn = isLastTurn && isCurrentStreaming
      
      // CRITICAL CHANGE: We only 'hide' history during regeneration if it's NOT the version we are currently building.
      // But for grouped mode, we actually want to show ALL tools in the current version.
      const isRegeneratingOldContent = isActuallyStreamingThisTurn && assistantMessages.some(m => m.metadata?.active === true) && turn.assistantVersions.length > 1 && activeVersionIdx < turn.assistantVersions.length - 1

      if (toolDisplayMode === 'grouped') {
        const turnTools: Record<string, { calls: ToolCall[], results: ToolResult[] }> = {}
        let totalPromptTokens = 0
        let totalCompletionTokens = 0
        let lastGenInfo: GenInfo | null = null

        // ALWAYS collect from history (the current selected version)
        assistantMessages.forEach(msg => {
          if (msg.generationInfo) {
            totalPromptTokens += msg.generationInfo.promptTokens || 0
            totalCompletionTokens += msg.generationInfo.completionTokens || 0
            lastGenInfo = msg.generationInfo
          }
          if (msg.toolCalls) {
            msg.toolCalls.forEach(tc => {
              const type = getToolType(tc.name)
              if (!turnTools[type]) turnTools[type] = { calls: [], results: [] }
              if (!turnTools[type].calls.some(c => c.id === tc.id)) {
                turnTools[type].calls.push(tc)
                const res = msg.toolResults?.find(r => r.toolCallId === tc.id)
                if (res) turnTools[type].results.push(res)
              }
            })
          }
        })

        // ALSO collect from active stream if this is the active turn
        if (isActuallyStreamingThisTurn && activeToolCalls.length > 0) {
          activeToolCalls.forEach(tc => {
            const type = getToolType(tc.name)
            if (!turnTools[type]) turnTools[type] = { calls: [], results: [] }
            if (!turnTools[type].calls.some(c => c.id === tc.id)) {
              turnTools[type].calls.push(tc)
            }
            const res = activeToolResults.find(r => r.toolCallId === tc.id)
            if (res && !turnTools[type].results.some(r => r.toolCallId === res.toolCallId)) {
              turnTools[type].results.push(res)
            }
          })
        }

        // Push aggregated tool blocks
        Object.keys(turnTools).forEach((type, idx) => {
          items.push({
            type: 'aggregated_tools',
            toolType: type,
            calls: turnTools[type].calls,
            results: turnTools[type].results,
            turnId: turnIdx,
            isFirstInTurn: idx === 0,
            key: `agg-${turnIdx}-${type}-${activeVersionIdx}`
          })
        })

        // Push assistant messages
        if (!isRegeneratingOldContent) {
          const filtered = assistantMessages.filter(msg => {
            const hasContent = msg.content && msg.content.trim().length > 0
            const isFinalAnswer = !msg.toolCalls || msg.toolCalls.length === 0
            return hasContent && (isFinalAnswer || msg.content.length > 100)
          })

          filtered.forEach((msg, idx) => {
            const isLast = idx === filtered.length - 1
            items.push({ 
              type: 'message', 
              message: { ...msg },
              aggregatedGenInfo: (isLast && lastGenInfo) ? {
                ...lastGenInfo,
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                tokensUsed: totalPromptTokens + totalCompletionTokens
              } : undefined,
              onRegenerate: isLast ? () => {
                regenerateMessage(msg.id)
                setTurnVersions(prev => {
                  const next = { ...prev }; delete next[turnKey]; return next
                })
              } : undefined,
              versionInfo: isLast && turn.assistantVersions.length > 1 ? {
                current: activeVersionIdx + 1,
                total: turn.assistantVersions.length,
                onPrev: () => setTurnVersions(p => ({ ...p, [turnKey]: activeVersionIdx - 1 })),
                onNext: () => setTurnVersions(p => ({ ...p, [turnKey]: activeVersionIdx + 1 }))
              } : undefined
            })
          })
        }

        // Push streaming preview
        if (isActuallyStreamingThisTurn) {
          const hasVisibleStream = streamingContent || streamingThinking || activeToolCalls.length > 0
          if (hasVisibleStream) {
            items.push({ 
              type: 'streaming_preview', 
              content: streamingContent, 
              thinking: streamingThinking, 
              activeCalls: [], 
              activeToolResults,
              generationInfo: currentSessionId ? streaming[currentSessionId]?.generationInfo : undefined
            })
          }
        }
      } else {
        // Individual tool mode (standard)
        assistantMessages.forEach(msg => items.push({ type: 'message', message: msg }))
        if (isActuallyStreamingThisTurn) {
          items.push({ 
            type: 'streaming_preview', 
            content: streamingContent, 
            thinking: streamingThinking, 
            activeCalls: activeToolCalls, 
            activeToolResults: activeToolResults,
            generationInfo: currentSessionId ? streaming[currentSessionId]?.generationInfo : undefined
          })
        }
      }
    })

    return items
  }, [messages, isCurrentStreaming, currentSessionId, streaming, streamingContent, streamingThinking, activeToolCalls, activeToolResults, toolDisplayMode, turnVersions, regenerateMessage])

  useEffect(() => {
    if (!highlightMessageId || !scrollRef.current) return
    const timer = setTimeout(() => {
      const el = scrollRef.current?.querySelector(`[data-message-id="${highlightMessageId}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    const clearTimer = setTimeout(() => setSearchHighlight(null), 5000)
    return () => { clearTimeout(timer); clearTimeout(clearTimer); }
  }, [highlightMessageId, currentSessionId, setSearchHighlight])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const handleScroll = () => {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
      setAutoScroll(isNearBottom)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !autoScroll) return
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight })
  }, [renderItems, isCurrentStreaming, autoScroll])

  const getToolIcon = (type: string) => {
    switch (type) {
      case 'search': return <Globe className="w-4 h-4 text-accent" />
      case 'browse': return <Link2 className="w-4 h-4 text-accent" />
      case 'code': return <Terminal className="w-4 h-4 text-accent" />
      default: return <Wrench className="w-4 h-4 text-accent" />
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 pt-24 pb-32">
          {renderItems.length === 0 && !isCurrentStreaming && (() => {
            const { selectedProvider, selectedModel } = useSettingsStore.getState()
            const ProviderIcon = getProviderIcon(`${selectedProvider}/${selectedModel}`)
            return (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 pt-[15vh]"
            >
              <div className="relative group">
                <div className="absolute -inset-8 bg-accent/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                <div className="relative flex items-center justify-center transform group-hover:scale-105 transition-transform duration-500">
                  <ProviderIcon size={112} />
                </div>
              </div>
              <div className="space-y-2">
                <h1 className="text-4xl font-display font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/50 bg-clip-text text-transparent">
                  What's on your mind?
                </h1>
                <p className="text-muted-foreground text-lg">Search the web, run code, or just chat.</p>
              </div>
            </motion.div>
          )})()}

          <AnimatePresence initial={false}>
            {renderItems.map((item) => {
              if (item.type === 'message') {
                return (
                  <motion.div
                    key={item.message.id}
                    data-message-id={item.message.id}
                    initial={item.message.role === 'user' ? { opacity: 0, y: 10 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <MessageBubble 
                      message={item.message} 
                      searchHighlight={searchHighlight} 
                      hideTools={toolDisplayMode === 'grouped'} 
                      aggregatedGenInfo={item.aggregatedGenInfo}
                      onRegenerate={item.onRegenerate}
                      versionInfo={item.versionInfo}
                      sessionId={currentSessionId || undefined}
                    />
                  </motion.div>
                )
              }

              if (item.type === 'aggregated_tools') {
                return (
                  <div key={item.key} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-sm flex items-center justify-center flex-shrink-0 mt-1">
                      {getToolIcon(item.toolType)}
                    </div>
                    <div className="flex-1">
                      <ToolCallBlock toolCalls={item.calls} results={item.results} hideHeaderIcon />
                    </div>
                  </div>
                )
              }

              if (item.type === 'streaming_preview') {
                if (toolDisplayMode === 'timeline' && streamState?.timeline && streamState.timeline.length > 0) {
                  return (
                    <div key="streaming" className="group flex items-start gap-3 animate-in fade-in duration-200">
                      <div className="w-10 h-10 rounded-sm flex items-center justify-center flex-shrink-0 mt-1">
                      {(() => {
                        const Icon = getProviderIcon(`${currentSession?.provider || selectedProvider}/${currentSession?.model || selectedModel}`)
                        return <Icon size={32} className="text-accent" />
                      })()}
                      </div>
                      <div className="flex-1 space-y-2 min-w-0">
                        {(() => {
                          const start = streamState.timeline[0].timestamp
                          const lastEvent = streamState.timeline[streamState.timeline.length - 1]
                          const isDoneThinking = lastEvent?.type === 'content'
                          const end = isDoneThinking ? lastEvent.timestamp : Date.now()
                          const duration = Math.round((end - start) / 1000)
                          const sublabel = getActivitySublabel(streamState.timeline, streamState.toolResults || [])
                          const label = duration > 0 ? `Working for ${duration}s` : 'Working...'
                          
                          return (
                            <button
                              onClick={() => {
                                useUIStore.getState().setActiveActivityMessageId('streaming')
                                useUIStore.getState().setActivityPanelOpen(true)
                              }}
                              className="transition-colors mb-2 text-[15px] w-fit font-medium"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className={cn(
                                  isDoneThinking ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground hover:text-foreground animate-pulse"
                                )}>{isDoneThinking ? `Worked for ${duration}s` : label}</span>
                                <ChevronRight className="w-4 h-4 text-muted-foreground/70 flex-shrink-0" />
                              </div>
                              {sublabel && (
                                <span 
                                  className={cn(
                                    "text-xs text-muted-foreground/70 block mt-0.5 max-w-[240px] whitespace-nowrap overflow-hidden",
                                    sublabel.type === 'thinking' ? "flex justify-end [mask-image:linear-gradient(to_right,transparent,black_20%)]" : "truncate"
                                  )}
                                >
                                  {sublabel.text}
                                </span>
                              )}
                            </button>
                          )
                        })()}
                        {item.content && <MarkdownRenderer content={item.content} streaming />}
                        {(item.generationInfo || (item.content && !isCurrentStreaming)) && (
                          <div className="flex items-center gap-4 mt-2">
                            {item.generationInfo && <GenerationInfo info={item.generationInfo} />}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(item.content || '')
                                  alert('Content copied to clipboard')
                                }}
                                title="Copy content"
                                className="p-1 hover:bg-secondary rounded-none transition-all text-muted-foreground/40 hover:text-accent"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }
                return (
                  <div key="streaming" className="group flex items-start gap-3 animate-in fade-in duration-200">
                    <div className="w-10 h-10 rounded-sm flex items-center justify-center flex-shrink-0 mt-1">
                      {(() => {
                        const Icon = getProviderIcon(`${currentSession?.provider || selectedProvider}/${currentSession?.model || selectedModel}`)
                        return <Icon size={32} className="text-accent" />
                      })()}
                    </div>
                    <div className="flex-1 space-y-2 min-w-0">
                      {item.thinking && <ThinkingBlock thinking={item.thinking} done={!!item.content} />}
                      {item.activeCalls.length > 0 && <div className="space-y-2 mb-2"><ToolCallBlock toolCalls={item.activeCalls} results={item.activeToolResults} /></div>}
                      {item.content && <MarkdownRenderer content={item.content} streaming />}
                      {(item.generationInfo || (item.content && !isCurrentStreaming)) && (
                        <div className="flex items-center gap-4 mt-2">
                          {item.generationInfo && <GenerationInfo info={item.generationInfo} />}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(item.content || '')
                                alert('Content copied to clipboard')
                              }}
                              title="Copy content"
                              className="p-1 hover:bg-secondary rounded-none transition-all text-muted-foreground/40 hover:text-accent"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              }
              return null
            })}
          </AnimatePresence>

          {(() => {
            const lastItem = renderItems[renderItems.length - 1]
            const isWaitingAfterUser = lastItem?.type === 'message' && lastItem.message.role === 'user'
            if (isCurrentStreaming && isWaitingAfterUser && !streamingContent && !streamingThinking && activeToolCalls.length === 0) {
              return (
                <div className="flex items-start gap-3 animate-in fade-in duration-200">
                  <div className="w-10 h-10 rounded-sm flex items-center justify-center flex-shrink-0 mt-1">
                    {(() => {
                      const Icon = getProviderIcon(`${currentSession?.provider || selectedProvider}/${currentSession?.model || selectedModel}`)
                      return <Icon size={32} className="text-accent animate-pulse" />
                    })()}
                  </div>
                  <div className="flex gap-1 mt-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )
            }
            return null
          })()}
          <div className="h-px w-full overflow-anchor-auto" />
        </div>
      </div>

      {!autoScroll && isCurrentStreaming && (
        <button
          onClick={() => {
            setAutoScroll(true)
            requestAnimationFrame(() => {
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
            })
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 bg-background border border-border rounded-full shadow-lg hover:border-accent transition-colors text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="w-4 h-4" />
          Follow conversation
        </button>
      )}
    </div>
  )
}
