import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Code, ExternalLink } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { cn } from '../lib/utils'

export function ArtifactPanel() {
  const { activeArtifact, artifactPanelOpen, setArtifactPanelOpen, setActiveArtifact } = useUIStore()

  const handleOpenInNewWindow = () => {
    if (!activeArtifact) return
    
    const newWindow = window.open('', '_blank', 'width=800,height=600')
    if (!newWindow) return

    if (activeArtifact.type === 'html') {
      newWindow.document.write(activeArtifact.content)
      newWindow.document.close()
    } else if (activeArtifact.type === 'svg') {
      newWindow.document.write(`<!DOCTYPE html><html><body>${activeArtifact.content}</body></html>`)
      newWindow.document.close()
    } else {
      newWindow.document.write(`<!DOCTYPE html><html><body><pre>${activeArtifact.content}</pre></body></html>`)
      newWindow.document.close()
    }
  }

  return (
    <AnimatePresence>
      {artifactPanelOpen && activeArtifact && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 480, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="flex-shrink-0 border-l border-border bg-card/50 backdrop-blur-sm flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Code className="w-4 h-4 text-accent" />
              <span className="text-sm font-medium truncate max-w-[200px]">{activeArtifact.title}</span>
              <span className="text-xs text-muted-foreground uppercase">{activeArtifact.language}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleOpenInNewWindow}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
                title="Open in new window"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setArtifactPanelOpen(false)
                  setActiveArtifact(null)
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            {activeArtifact.type === 'html' || activeArtifact.type === 'markdown' ? (
              <iframe
                srcDoc={activeArtifact.content}
                className="w-full h-full border-0"
                sandbox="allow-scripts"
              />
            ) : activeArtifact.type === 'svg' ? (
              <div className="w-full h-full p-4 overflow-auto">
                <div dangerouslySetInnerHTML={{ __html: activeArtifact.content }} />
              </div>
            ) : (
              <pre className="w-full h-full p-4 overflow-auto text-sm font-mono">
                <code>{activeArtifact.content}</code>
              </pre>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
