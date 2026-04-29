import React, { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChatStore } from '../stores/chatStore'
import { useUIStore } from '../stores/uiStore'
import { MessageBubble } from './MessageBubble'
import { Bot, Wrench } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ThinkingBlock } from './ThinkingBlock'

export function ChatWindow() {
  const { sessions, currentSessionId, streaming } = useChatStore()
  const { searchHighlight, highlightMessageId, setSearchHighlight } = useUIStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const messages = currentSession?.messages || []

  // Per-session streaming state for the CURRENT session
  const streamState = currentSessionId ? streaming[currentSessionId] : null
  const isCurrentStreaming = streamState?.isGenerating ?? false
  const streamingContent = streamState?.content ?? ''
  const streamingThinking = streamState?.thinking ?? ''
  const activeToolCalls = streamState?.toolCalls ?? []

  // Scroll to highlighted message when search highlight changes
  useEffect(() => {
    if (!highlightMessageId || !scrollRef.current) return

    // Small delay to let the DOM update after session switch
    const timer = setTimeout(() => {
      const el = scrollRef.current?.querySelector(`[data-message-id="${highlightMessageId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)

    // Auto-clear highlight after 5 seconds
    const clearTimer = setTimeout(() => {
      setSearchHighlight(null)
    }, 5000)

    return () => {
      clearTimeout(timer)
      clearTimeout(clearTimer)
    }
  }, [highlightMessageId, currentSessionId, setSearchHighlight])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100

    if (isNearBottom || isCurrentStreaming) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight
      })
    }
  }, [messages.length, streamingContent, streamingThinking, isCurrentStreaming])

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      <div 
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {messages.length === 0 && !isCurrentStreaming && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 pt-[15vh]"
            >
              <div className="relative group">
                <div className="absolute -inset-4 bg-accent/20 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative w-24 h-24 rounded-full border-2 border-accent/20 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                  <div className="w-16 h-16 rounded-full border-4 border-accent flex items-center justify-center">
                    <div className="w-8 h-8 bg-accent rounded-full animate-pulse" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <h1 className="text-4xl font-display font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/50 bg-clip-text text-transparent">
                  What do you want to know?
                </h1>
                <p className="text-muted-foreground text-lg">
                  Ask anything or start a new project.
                </p>
              </div>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((message, index) => {
              const isHighlighted = highlightMessageId === message.id
              return (
              <motion.div
                key={message.id}
                data-message-id={message.id}
                initial={message.role === 'user' ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={isHighlighted ? 'ring-2 ring-accent/60 rounded-sm transition-all duration-500' : ''}
              >
                <MessageBubble message={message} searchHighlight={searchHighlight} />
              </motion.div>
              )
            })}
          </AnimatePresence>

          {isCurrentStreaming && (streamingContent || streamingThinking || activeToolCalls.length > 0) && (
            <div className="flex items-start gap-3 animate-in fade-in duration-200">
              <div className="w-7 h-7 rounded-sm bg-accent/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-4 h-4 text-accent" />
              </div>
              <div className="flex-1 space-y-2 min-w-0">
                {streamingThinking && (
                  <ThinkingBlock thinking={streamingThinking} done={!!streamingContent} />
                )}
                {streamingContent && (
                  <MarkdownRenderer content={streamingContent} streaming />
                )}
              </div>
            </div>
          )}

          {/* Waiting indicator: generating but no visible text yet */}
          {isCurrentStreaming && !streamingContent && !streamingThinking && (
            <div className="flex items-start gap-3 animate-in fade-in duration-200">
              <div className="w-7 h-7 rounded-sm bg-accent/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-4 h-4 text-accent animate-pulse" />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div className="h-px w-full overflow-anchor-auto" />
        </div>
      </div>
    </div>
  )
}
