import React, { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChatStore } from '../stores/chatStore'
import { MessageBubble } from './MessageBubble'
import { Bot, Wrench } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ThinkingBlock } from './ThinkingBlock'

export function ChatWindow() {
  const { sessions, currentSessionId, isGenerating, streamingContent, streamingThinking, activeToolCalls } = useChatStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const messages = currentSession?.messages || []

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100

    if (isNearBottom || isGenerating) {
      // Use requestAnimationFrame for smoother synchronization with layout changes
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight
      })
    }
  }, [messages.length, streamingContent, streamingThinking, isGenerating])

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      <div 
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto scroll-smooth"
      >
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {messages.length === 0 && !isGenerating && (
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
            {messages.map((message, index) => (
              <motion.div
                key={message.id}
                initial={message.role === 'user' ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <MessageBubble message={message} />
              </motion.div>
            ))}
          </AnimatePresence>

          {(streamingContent || streamingThinking || activeToolCalls.length > 0) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-start gap-3"
            >
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
                {activeToolCalls.length > 0 && (
                  <div className="space-y-2 w-full max-w-2xl">
                    {activeToolCalls.map(tc => (
                      <div key={tc.id} className="border border-border rounded-sm overflow-hidden bg-secondary/10">
                        <div className="flex items-center gap-2 px-3 py-2 bg-secondary/40 border-b border-border text-xs font-mono text-muted-foreground">
                          <Wrench className="w-3.5 h-3.5 text-accent animate-pulse" />
                          <span>Executing: <span className="text-foreground">{tc.name}</span></span>
                        </div>
                        <div className="px-3 py-2 text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                          {typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments, null, 2)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
          <div className="h-px w-full overflow-anchor-auto" />
        </div>
      </div>
    </div>
  )
}
