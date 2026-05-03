import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { useChatStore } from '../stores/chatStore'
import { TimelineView } from './TimelineView'

export function ActivityPanel() {
  const { activityPanelOpen, activeActivityMessageId, setActivityPanelOpen } = useUIStore()
  const { sessions, currentSessionId, streaming } = useChatStore()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const updateIsMobile = () => setIsMobile(mediaQuery.matches)

    updateIsMobile()
    mediaQuery.addEventListener('change', updateIsMobile)
    return () => mediaQuery.removeEventListener('change', updateIsMobile)
  }, [])
  
  const session = sessions.find(s => s.id === currentSessionId)
  let message = null
  let events: any[] = []
  let toolResults: any[] = []
  let isGenerating = false

  if (activeActivityMessageId && session) {
    message = session.messages.find(m => m.id === activeActivityMessageId) || null
    
    // Check if this is the currently streaming message
    const streamState = currentSessionId ? streaming[currentSessionId] : null
    const isStreamingMsg = activeActivityMessageId === 'streaming'
    
    if (isStreamingMsg && streamState) {
      events = streamState.timeline || []
      toolResults = streamState.toolResults || []
      isGenerating = streamState.isGenerating
    } else if (message) {
      events = message.timeline || []
      toolResults = message.toolResults || []
    }
  }

  // Calculate duration if possible
  const durationStr = (() => {
    if (events.length === 0) return ''
    const start = events[0].timestamp
    const end = isGenerating ? Date.now() : events[events.length - 1].timestamp
    const secs = Math.round((end - start) / 1000)
    return ` - ${secs}s`
  })()

  const handleDismiss = () => setActivityPanelOpen(false)

  return (
    <AnimatePresence>
      {activityPanelOpen && activeActivityMessageId && (
        isMobile ? (
          <>
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="fixed inset-0 z-30 bg-background/60 backdrop-blur-[2px]"
              onClick={handleDismiss}
              aria-label="Close activity panel"
            />

            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              drag="y"
              dragDirectionLock
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.2 }}
              onDragEnd={(_event, info) => {
                if (info.offset.y > 120 || info.velocity.y > 700) {
                  handleDismiss()
                }
              }}
              className="fixed inset-x-0 bottom-0 z-40 flex max-h-[78vh] min-h-[42vh] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-card/95 shadow-2xl backdrop-blur-xl"
            >
              <div className="flex justify-center pt-2 pb-1">
                <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
              </div>

              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="text-sm font-medium text-foreground">Activity</span>
                  {durationStr && <span className="text-xs">{durationStr}</span>}
                </div>
                <button
                  onClick={handleDismiss}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {events.length > 0 ? (
                  <TimelineView 
                    events={events} 
                    toolResults={toolResults}
                    isStreaming={isGenerating}
                  />
                ) : (
                  <div className="text-sm text-muted-foreground italic">No activity recorded for this message.</div>
                )}
              </div>
            </motion.div>
          </>
        ) : (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="flex-shrink-0 border-l border-border bg-card/50 backdrop-blur-sm flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-sm font-medium text-foreground">Activity</span>
                {durationStr && <span className="text-xs">{durationStr}</span>}
              </div>
              <button
                onClick={handleDismiss}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {events.length > 0 ? (
                <TimelineView 
                  events={events} 
                  toolResults={toolResults}
                  isStreaming={isGenerating}
                />
              ) : (
                <div className="text-sm text-muted-foreground italic">No activity recorded for this message.</div>
              )}
            </div>
          </motion.div>
        )
      )}
    </AnimatePresence>
  )
}
