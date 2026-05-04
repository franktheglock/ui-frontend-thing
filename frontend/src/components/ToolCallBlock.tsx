import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Globe, ChevronRight, Search, Terminal, Link2, FileText, Loader2, Bot } from 'lucide-react'
import { ToolCall, ToolResult } from '../stores/chatStore'
import { cn } from '../lib/utils'

interface ToolCallBlockProps {
  toolCalls: ToolCall[]
  results?: ToolResult[]
  hideHeaderIcon?: boolean
}

function parseToolArgs(value: unknown): Record<string, any> {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, any>

  const raw = String(value).trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    let s = raw
    while (s.endsWith('\\')) s = s.slice(0, -1)
    let inStr = false
    let esc = false
    let lastQuoteIdx = -1
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') { inStr = !inStr; lastQuoteIdx = i }
    }
    if (inStr && lastQuoteIdx >= 0) s = s.slice(0, lastQuoteIdx) + '"'
    s = s.replace(/,\s*([}\]])/g, '$1')

    let openBraces = 0
    let openBrackets = 0
    inStr = false
    esc = false
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === '{') openBraces++
      else if (c === '}') openBraces--
      else if (c === '[') openBrackets++
      else if (c === ']') openBrackets--
    }
    while (openBrackets > 0) { s += ']'; openBrackets-- }
    while (openBraces > 0) { s += '}'; openBraces-- }

    try { return JSON.parse(s) } catch { return {} }
  }
}

function getToolArgs(toolCall: ToolCall): Record<string, any> {
  const rawCall = toolCall as any
  const args = parseToolArgs(rawCall.arguments ?? rawCall.function?.arguments ?? rawCall.input)
  return parseToolArgs(args.arguments ?? args.input ?? args)
}

function getQuery(args: Record<string, any>) {
  const q = (
    args.query ?? 
    args.q ?? 
    args.search ?? 
    args.question ?? 
    args.prompt ?? 
    args.text ?? 
    args.input ?? 
    args.search_query ??
    (Array.isArray(args.queries) ? args.queries[0] : args.queries)
  )
  return q ? String(q).trim() : ''
}

function getUrl(args: Record<string, any>, resultText?: string) {
  const direct = String(args.url ?? args.URL ?? args.uri ?? args.href ?? '').trim()
  if (direct) return direct
  const match = resultText?.match(/URL:\s*(https?:\/\/[^\s]+)/)
  return match?.[1] || ''
}

function parseSubagentResult(resultText: string) {
  try {
    return JSON.parse(resultText)
  } catch {
    return null
  }
}

export function ToolCallBlock({ toolCalls, results = [], hideHeaderIcon = false }: ToolCallBlockProps) {
  const isRunning = toolCalls.some(tc => !results.some(r => r.toolCallId === tc.id))
  const [isOpen, setIsOpen] = useState(() => isRunning)
  const [userToggled, setUserToggled] = useState(false)

  React.useEffect(() => {
    if (isRunning && !userToggled) {
      setIsOpen(true)
    }
  }, [isRunning, userToggled])

  const handleToggle = () => {
    setIsOpen(!isOpen)
    setUserToggled(true)
  }

  const firstCall = toolCalls[0]
  if (!firstCall) return null

  const isSubagent = firstCall.name === 'spawn_subagent'
  const isWebSearch = firstCall.name === 'web_search' || firstCall.name?.toLowerCase().includes('search')
  const isReadUrl = firstCall.name === 'read_url' || firstCall.name === 'read_browser_page'
  const groupCount = toolCalls.length

  // Collect all unique domains/hosts for the header badge
  const allUrls: string[] = []
  toolCalls.forEach(tc => {
    const url = getUrl(getToolArgs(tc))
    if (url) allUrls.push(url)
  })

  // Collect all result URLs for web search
  const allResultUrls: string[] = []
  results.forEach(res => {
    const text = typeof res.result === 'string' ? res.result : JSON.stringify(res.result)
    const urlRegex = /URL:\s*(https?:\/\/[^\s]+)/g
    let match
    while ((match = urlRegex.exec(text)) !== null) {
      allResultUrls.push(match[1])
    }
  })
  const uniqueResultUrls = Array.from(new Set(allResultUrls))

  return (
    <div className="border border-border rounded-none overflow-hidden bg-secondary/10 max-w-2xl w-full min-w-0">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-secondary/40 hover:bg-secondary/60 transition-colors text-sm"
      >
        <div className="flex items-center gap-2 text-muted-foreground">
          {!hideHeaderIcon && (
            isSubagent ? <Bot className="w-3.5 h-3.5 text-accent" /> : isWebSearch ? <Globe className="w-3.5 h-3.5 text-accent" /> : isReadUrl ? <Link2 className="w-3.5 h-3.5 text-accent" /> : <Terminal className="w-3.5 h-3.5 text-accent" />
          )}
          <span className="font-medium text-foreground">
            {(() => {
              const allNames = new Set(toolCalls.map(tc => tc.name))
              if (allNames.size === 1) {
                return isSubagent ? 'subagent' : isWebSearch ? 'web_search' : isReadUrl ? 'read_url' : firstCall.name
              }
              // If mixed tools in a type group
              if (isSubagent) return 'subagent'
              if (isWebSearch) return 'web_search'
              if (isReadUrl) return 'browsing'
              if (firstCall.name === 'python' || firstCall.name === 'terminal') return 'code_execution'
              return firstCall.name
            })()}
          </span>
          {groupCount > 1 && (
            <span className="text-[10px] font-bold bg-accent text-accent-foreground px-1 rounded-sm">
              X{groupCount}
            </span>
          )}
          {isRunning && <Loader2 className="w-3 h-3 animate-spin text-accent" />}
          {isWebSearch && (
            <span className="text-xs text-muted-foreground/70 bg-background/50 px-1.5 py-0.5 rounded-sm">
              {uniqueResultUrls.length > 0 ? `${uniqueResultUrls.length} sites` : 'searching...'}
            </span>
          )}
          {isReadUrl && allUrls.length > 0 && (
            <span className="text-xs text-muted-foreground/70 bg-background/50 px-1.5 py-0.5 rounded-sm truncate max-w-[150px]">
              {(() => {
                try { 
                  const host = new URL(allUrls[0]).hostname.replace('www.', '')
                  return allUrls.length > 1 ? `${host} +${allUrls.length - 1}` : host
                } catch { return allUrls[0] }
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
            <div className="p-3 space-y-4 bg-secondary/20">
              {toolCalls.map((tc, idx) => {
                const res = results.find(r => r.toolCallId === tc.id)
                const resultText = res ? (typeof res.result === 'string' ? res.result : JSON.stringify(res.result)) : ''
                const args = getToolArgs(tc)
                const query = getQuery(args)
                const url = getUrl(args, resultText)
                const subagentResult = isSubagent ? parseSubagentResult(resultText) : null

                return (
                  <div key={tc.id} className={cn("space-y-3", idx > 0 && "pt-4 border-t border-border/50")}>
                    {isSubagent ? (
                      <>
                        <div className="flex flex-col gap-1 text-xs">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Bot className="w-3 h-3" /> Scope {groupCount > 1 && `#${idx + 1}`}
                          </span>
                          <span className="font-mono text-foreground/90 bg-background/50 px-2 py-1 rounded-sm border border-border/50">
                            {String(args.scope || args.topic || 'General research')}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1 text-xs">
                          <span className="text-muted-foreground">Task</span>
                          <div className="text-foreground/90 bg-background/50 px-2 py-1 rounded-sm border border-border/50 whitespace-pre-wrap break-words">
                            {String(args.task || args.prompt || args.query || 'No task provided')}
                          </div>
                        </div>
                        {subagentResult ? (
                          <>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                              <span className="rounded-sm bg-background/50 px-1.5 py-0.5 border border-border/50">
                                {subagentResult.provider || 'provider'} / {subagentResult.model || 'model'}
                              </span>
                              <span className="rounded-sm bg-background/50 px-1.5 py-0.5 border border-border/50">
                                {subagentResult.toolTurns ?? 0} tool turns
                              </span>
                            </div>
                            <div className="flex flex-col gap-1 mt-2">
                              <span className="text-xs text-muted-foreground">Summary</span>
                              <div className="text-xs text-foreground/90 bg-background/50 p-2 rounded-sm border border-border/50 whitespace-pre-wrap break-words">
                                {String(subagentResult.summary || 'No summary returned')}
                              </div>
                            </div>
                            {Array.isArray(subagentResult.sources) && subagentResult.sources.length > 0 && (
                              <div className="flex flex-col gap-2 mt-2">
                                <span className="text-xs text-muted-foreground">Sources</span>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {subagentResult.sources.map((source: string, sourceIndex: number) => {
                                    let domain = source
                                    try { domain = new URL(source).hostname.replace('www.', '') } catch {}
                                    return (
                                      <a
                                        key={`${source}-${sourceIndex}`}
                                        href={source}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-2 py-1.5 bg-background border border-border rounded-sm hover:border-accent transition-colors overflow-hidden group"
                                      >
                                        <img
                                          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                                          alt=""
                                          className="w-4 h-4 flex-shrink-0 rounded-[2px]"
                                        />
                                        <span className="text-xs text-foreground/70 truncate">{domain}</span>
                                      </a>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </>
                        ) : resultText ? (
                          <div className="text-xs font-mono text-muted-foreground border-t border-border pt-2 mt-2 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words max-h-40">
                            <div className="text-foreground mb-1">Result:</div>
                            {resultText}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground italic px-2 mt-2">Running subagent...</div>
                        )}
                      </>
                    ) : isWebSearch ? (
                      <>
                        <div className="flex flex-col gap-1 text-xs">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Search className="w-3 h-3" /> Query {groupCount > 1 && `#${idx + 1}`}
                          </span>
                          <span className="font-mono text-foreground/90 bg-background/50 px-2 py-1 rounded-sm border border-border/50">
                            {query || (Object.keys(args).length > 0 ? JSON.stringify(args) : 'Searching...')}
                          </span>
                        </div>

                        {/* Note: We show aggregate sources found below all calls if needed, 
                            but per-call sources are better if they exist. 
                            For now, let's parse per-call URLs. */}
                        {(() => {
                          if (!resultText) return null
                          
                          const callUrls: string[] = []
                          const urlRegex = /URL:\s*(https?:\/\/[^\s]+)/g
                          let match
                          while ((match = urlRegex.exec(resultText)) !== null) {
                            callUrls.push(match[1])
                          }
                          
                          if (callUrls.length === 0) {
                            return (
                              <div className="text-xs text-muted-foreground italic px-2 mt-2 bg-background/30 p-2 rounded-sm border border-border/30">
                                {resultText}
                              </div>
                            )
                          }
                          
                          return (
                            <div className="flex flex-col gap-2 mt-2">
                              <span className="text-xs text-muted-foreground">Sources Found</span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {callUrls.map((url, i) => {
                                  let domain = url
                                  try { domain = new URL(url).hostname.replace('www.', '') } catch {}
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
                                      <span className="text-xs text-foreground/70 truncate">{domain}</span>
                                    </a>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })()}
                        
                        {!resultText && (
                          <div className="text-xs text-muted-foreground italic px-2 mt-2">Searching...</div>
                        )}
                      </>
                    ) : isReadUrl ? (
                      <>
                        <div className="flex flex-col gap-1 text-xs">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Link2 className="w-3 h-3" /> Target URL {groupCount > 1 && `#${idx + 1}`}
                          </span>
                          <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-accent hover:underline bg-background/50 px-2 py-1 rounded-sm border border-border/50 break-all min-w-0 overflow-hidden">
                            {url}
                          </a>
                        </div>

                        {resultText && (
                          <div className="flex flex-col gap-1 mt-3">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <FileText className="w-3 h-3" /> Content Read
                            </span>
                            <div className="text-xs font-mono text-muted-foreground bg-background/50 p-2 rounded-sm border border-border/50 whitespace-pre-wrap break-words max-h-40 overflow-y-auto overflow-x-hidden">
                              {resultText}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                          <div className="text-foreground mb-1">Arguments {groupCount > 1 && `#${idx + 1}`}:</div>
                          {typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments, null, 2)}
                        </div>
                        {resultText && (
                          <div className="text-xs font-mono text-muted-foreground border-t border-border pt-2 mt-2 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words max-h-40">
                            <div className="text-foreground mb-1">Result:</div>
                            {resultText}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
