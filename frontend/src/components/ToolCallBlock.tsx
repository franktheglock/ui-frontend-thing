import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Globe, ChevronRight, Search, Terminal, Link2, FileText } from 'lucide-react'
import { ToolCall, ToolResult } from '../stores/chatStore'
import { cn } from '../lib/utils'

interface ToolCallBlockProps {
  toolCall: ToolCall
  result?: ToolResult
}

export function ToolCallBlock({ toolCall, result }: ToolCallBlockProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Parse arguments to get query if it's a web search
  let query = 'Unknown query'
  let url = ''
  let isWebSearch = toolCall.name === 'web_search'
  let isReadUrl = toolCall.name === 'read_url' || toolCall.name === 'read_browser_page'
  
  try {
    const args = typeof toolCall.arguments === 'string' ? JSON.parse(toolCall.arguments) : toolCall.arguments
    if (args.query) query = args.query
    if (args.url) url = args.url
  } catch {}

  // Parse result to get URLs and domains
  const urls: string[] = []
  const resultText = typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result || '')
  
  if (isWebSearch && resultText) {
    const urlRegex = /URL:\s*(https?:\/\/[^\s]+)/g
    let match
    while ((match = urlRegex.exec(resultText)) !== null) {
      urls.push(match[1])
    }
  }

  const numResults = urls.length

  return (
    <div className="border border-border rounded-none overflow-hidden bg-secondary/10 max-w-2xl">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-secondary/40 hover:bg-secondary/60 transition-colors text-sm"
      >
        <div className="flex items-center gap-2 text-muted-foreground">
          {isWebSearch ? <Globe className="w-3.5 h-3.5 text-accent" /> : isReadUrl ? <Link2 className="w-3.5 h-3.5 text-accent" /> : <Terminal className="w-3.5 h-3.5 text-accent" />}
          <span className="font-medium text-foreground">
            {isWebSearch ? 'web_search' : isReadUrl ? 'read_url' : toolCall.name}
          </span>
          {isWebSearch && (
            <span className="text-xs text-muted-foreground/70 bg-background/50 px-1.5 py-0.5 rounded-sm">
              {numResults > 0 ? `${numResults} sites` : 'searching...'}
            </span>
          )}
          {isReadUrl && url && (
            <span className="text-xs text-muted-foreground/70 bg-background/50 px-1.5 py-0.5 rounded-sm truncate max-w-[150px]">
              {(() => {
                try { return new URL(url).hostname.replace('www.', '') } catch { return url }
              })()}
            </span>
          )}
        </div>
        <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border"
          >
            <div className="p-3 space-y-3 bg-secondary/20">
              {isWebSearch ? (
                <>
                  <div className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Search className="w-3 h-3" /> Query
                    </span>
                    <span className="font-mono text-foreground/90 bg-background/50 px-2 py-1 rounded-sm border border-border/50">
                      {query}
                    </span>
                  </div>

                  {urls.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs text-muted-foreground">Sources Found</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {urls.map((url, i) => {
                          let domain = url
                          try {
                            domain = new URL(url).hostname.replace('www.', '')
                          } catch {}
                          
                          return (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-2 py-1.5 bg-background border border-border rounded-sm hover:border-accent transition-colors overflow-hidden group"
                            >
                              <img 
                                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} 
                                alt=""
                                className="w-4 h-4 flex-shrink-0 rounded-[2px]"
                              />
                              <span className="text-xs text-foreground/70 truncate">
                                {domain}
                              </span>
                            </a>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Fallback to raw result if no URLs parsed, or just show raw result for debugging */}
                  {urls.length === 0 && resultText && (
                    <div className="text-xs font-mono text-muted-foreground bg-background/50 p-2 rounded-sm border border-border/50 whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {resultText}
                    </div>
                  )}
                </>
              ) : isReadUrl ? (
                <>
                  <div className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Link2 className="w-3 h-3" /> Target URL
                    </span>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-accent hover:underline bg-background/50 px-2 py-1 rounded-sm border border-border/50 truncate">
                      {url}
                    </a>
                  </div>

                  {resultText && (
                    <div className="flex flex-col gap-1 mt-3">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Content Read
                      </span>
                      <div className="text-xs font-mono text-muted-foreground bg-background/50 p-2 rounded-sm border border-border/50 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {resultText}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Generic Tool Call Fallback */}
                  <div className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                    <div className="text-foreground mb-1">Arguments:</div>
                    {typeof toolCall.arguments === 'string' ? toolCall.arguments : JSON.stringify(toolCall.arguments, null, 2)}
                  </div>
                  {resultText && (
                    <div className="text-xs font-mono text-muted-foreground border-t border-border pt-2 mt-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                      <div className="text-foreground mb-1">Result:</div>
                      {resultText}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
