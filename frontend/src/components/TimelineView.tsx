import { useState, useRef, useEffect, useCallback } from 'react'
import { Brain, Code, Globe, FileText, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Search } from 'lucide-react'
import { TimelineEvent, ToolResult } from '../stores/chatStore'
import { MarkdownRenderer } from './MarkdownRenderer'
import { cn } from '../lib/utils'

interface TimelineViewProps {
  events: TimelineEvent[]
  toolResults?: ToolResult[]
  isStreaming?: boolean
}

function getToolIcon(name: string) {
  if (name === 'web_search') return <Globe className="w-3.5 h-3.5" />
  if (name === 'read_url' || name === 'read_browser_page') return <FileText className="w-3.5 h-3.5" />
  if (name === 'python' || name === 'terminal') return <Code className="w-3.5 h-3.5" />
  return <Code className="w-3.5 h-3.5" />
}

function getToolLabel(name: string) {
  if (name === 'web_search') return 'web_search'
  if (name === 'read_url' || name === 'read_browser_page') return 'read_url'
  return name || 'tool'
}

function getTimelineStatus(events: TimelineEvent[], toolResults: ToolResult[] = [], isStreaming?: boolean) {
  const toolCalls = events.filter(e => e.type === 'tool_call')
  const unresolvedTools = toolCalls.filter(e => !toolResults.some(r => r.toolCallId === e.toolCallId))
  const latestEvent = [...events].reverse().find(e => e.type === 'thinking' || e.type === 'tool_call' || e.type === 'tool_result')

  if (!isStreaming && unresolvedTools.length === 0) {
    return { kind: 'done', label: 'done', detail: '' }
  }

  if (unresolvedTools.length > 0) {
    const names = Array.from(new Set(unresolvedTools.map(e => getToolLabel(e.toolName || ''))))
    const label = names.length === 1 ? names[0] : 'tools'
    const detail = unresolvedTools.length > 1 ? `${unresolvedTools.length} calls` : 'running'
    return { kind: 'tool', label, detail }
  }

  if (latestEvent?.type === 'thinking') {
    return { kind: 'thinking', label: 'thinking', detail: latestEvent.content.replace(/\s+/g, ' ').trim() }
  }

  if (latestEvent?.type === 'tool_result') {
    return isStreaming
      ? { kind: 'working', label: 'responding', detail: '' }
      : { kind: 'done', label: 'done', detail: '' }
  }

  return { kind: 'working', label: 'working', detail: '' }
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

function ToolCallDetails({ event, toolResult }: { event: TimelineEvent, toolResult?: ToolResult }) {
  const resultText = toolResult?.result || ''
  const rawArgs = parseToolArgs(event.toolArgs)
  const args = parseToolArgs(rawArgs.arguments ?? rawArgs.input ?? rawArgs)
  const query = getQuery(args)
  const targetUrl = getUrl(args, resultText)
  let urls: string[] = []
  if (toolResult) {
    const urlRegex = /URL:\s*(https?:\/\/[^\s]+)/g
    let match
    while ((match = urlRegex.exec(resultText)) !== null) {
      urls.push(match[1])
    }
  }

  const searchIcon = <Search className="w-3 h-3" />
  
  return (
    <div className="space-y-3">
      {(event.toolName === 'web_search' || event.toolName?.toLowerCase().includes('search')) && (
        <div className="flex flex-col gap-1 text-xs px-2">
          <span className="text-muted-foreground flex items-center gap-1">
            {searchIcon} Query
          </span>
          <span className="font-mono text-foreground/90 bg-background/50 px-2 py-1 rounded-sm border border-border/50 break-words">
            {query || (Object.keys(args).length > 0 ? JSON.stringify(args) : (String(event.toolArgs) || '...'))}
          </span>
        </div>
      )}

      {(event.toolName === 'read_url' || event.toolName === 'read_browser_page') && targetUrl && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <FileText className="w-3 h-3" /> Target URL
          </span>
          <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-accent hover:underline bg-background/50 px-2 py-1 rounded-sm border border-border/50 break-all">
            {targetUrl}
          </a>
        </div>
      )}

      {/* Show raw arguments for other tools or if query is missing for search */}
      {!(event.toolName === 'web_search' || event.toolName?.toLowerCase().includes('search')) && 
       !(event.toolName === 'read_url' || event.toolName === 'read_browser_page') && 
       (Object.keys(args).length > 0 || String(event.toolArgs || '').length > 0) && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Arguments</span>
          <div className="p-2 bg-background/50 border border-border/50 rounded-sm font-mono text-[11px] whitespace-pre-wrap break-all">
            {Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : String(event.toolArgs || '')}
          </div>
        </div>
      )}

      {!toolResult ? (
        <div className="text-[10px] text-muted-foreground italic px-2 flex items-center gap-1.5 pt-1">
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          Working...
        </div>
      ) : (
        <>
      {urls.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Sources</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {urls.slice(0, 6).map((url, i) => {
              let domain = url
              try { domain = new URL(url).hostname.replace('www.', '') } catch {}
              return (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-2 py-1 bg-background border border-border rounded-sm hover:border-accent transition-colors overflow-hidden"
                >
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                    alt=""
                    className="w-3.5 h-3.5 flex-shrink-0 rounded-[2px]"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <span className="text-[11px] text-foreground/70 truncate">{domain}</span>
                </a>
              )
            })}
          </div>
        </div>
      )}
      <div className="p-2 bg-secondary/30 border border-border rounded-none text-xs font-mono whitespace-pre-wrap max-h-48 overflow-auto overflow-x-hidden break-all text-muted-foreground">
        {resultText || (toolResult ? 'No output' : 'Running...')}
      </div>
      </>
      )}
    </div>
  )
}

function ToolCallItem({ event, toolResult }: { event: TimelineEvent, toolResult?: ToolResult }) {
  const [isOpen, setIsOpen] = useState(false)
  const isError = toolResult?.result.startsWith('Error:')

  return (
    <div className="relative flex gap-3 min-w-0">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center z-10",
          toolResult ? (isError ? "bg-red-500/10" : "bg-green-500/10") : "bg-secondary"
        )}>
          {toolResult ? (
            isError ? <AlertCircle className="w-3 h-3 text-red-400" /> : <CheckCircle2 className="w-3 h-3 text-green-400" />
          ) : (
            getToolIcon(event.toolName || '')
          )}
        </div>
      </div>
      <div className="flex-1 pb-2 min-w-0">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "w-full flex items-start gap-2 px-3 py-1.5 text-sm rounded-none border transition-colors",
            isOpen ? "bg-secondary border-border" : "bg-secondary/50 border-border hover:bg-secondary"
          )}
        >
          <div className="flex-shrink-0 mt-0.5">{getToolIcon(event.toolName || '')}</div>
          <div className="flex flex-col items-start min-w-0 overflow-hidden">
            <span className="font-medium truncate w-full">{event.toolName}</span>
          </div>
          {toolResult && (
            <span className={cn(
              "ml-auto text-xs px-1.5 py-0.5 rounded-none flex-shrink-0 mt-0.5",
              isError ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"
            )}>
              {isError ? 'Error' : 'Done'}
            </span>
          )}
          <div className="flex-shrink-0 mt-0.5">
            {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </div>
        </button>
        {isOpen && (
          <div className="mt-2">
            <ToolCallDetails event={event} toolResult={toolResult} />
          </div>
        )}
      </div>
    </div>
  )
}

function ToolCallGroupItem({ events, toolResults }: { events: TimelineEvent[], toolResults: ToolResult[] }) {
  const [isOpen, setIsOpen] = useState(false)
  const allDone = events.every(event => toolResults.some(result => result.toolCallId === event.toolCallId))
  const hasError = events.some(event => toolResults.find(result => result.toolCallId === event.toolCallId)?.result.startsWith('Error:'))
  const names = Array.from(new Set(events.map(event => getToolLabel(event.toolName || ''))))
  const label = names.length === 1 ? names[0] : 'tools'

  return (
    <div className="relative flex gap-3 min-w-0">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center z-10",
          allDone ? (hasError ? "bg-red-500/10" : "bg-green-500/10") : "bg-secondary"
        )}>
          {allDone ? (
            hasError ? <AlertCircle className="w-3 h-3 text-red-400" /> : <CheckCircle2 className="w-3 h-3 text-green-400" />
          ) : (
            getToolIcon(events[0]?.toolName || '')
          )}
        </div>
      </div>
      <div className="flex-1 pb-2 min-w-0">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "w-full flex items-start gap-2 px-3 py-1.5 text-sm rounded-none border transition-colors",
            isOpen ? "bg-secondary border-border" : "bg-secondary/50 border-border hover:bg-secondary"
          )}
        >
          <div className="flex-shrink-0 mt-0.5">{getToolIcon(events[0]?.toolName || '')}</div>
          <div className="flex flex-col items-start min-w-0 overflow-hidden">
            <span className="font-medium truncate w-full">{label}</span>
          </div>
          <span className="text-[10px] font-bold bg-accent text-accent-foreground px-1 rounded-sm flex-shrink-0 mt-0.5">
            X{events.length}
          </span>
          <span className={cn(
            "ml-auto text-xs px-1.5 py-0.5 rounded-none flex-shrink-0 mt-0.5",
            allDone
              ? hasError ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"
              : "bg-accent/10 text-accent"
          )}>
            {allDone ? (hasError ? 'Error' : 'Done') : 'Running'}
          </span>
          <div className="flex-shrink-0 mt-0.5">
            {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </div>
        </button>
        {isOpen && (
          <div className="mt-2 space-y-4">
            {events.map((event, idx) => {
              const toolResult = toolResults.find(result => result.toolCallId === event.toolCallId)
              return (
                <div key={event.toolCallId || `${event.timestamp}-${idx}`} className={cn(idx > 0 && "pt-4 border-t border-border/50")}>
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    {getToolIcon(event.toolName || '')}
                    <span className="font-medium text-foreground/80">{getToolLabel(event.toolName || '')}</span>
                    <span>#{idx + 1}</span>
                  </div>
                  <ToolCallDetails event={event} toolResult={toolResult} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export function TimelineView({ events, toolResults = [], isStreaming }: TimelineViewProps) {
  const [isOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [events, isOpen])

  const updateHeight = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    container.style.height = isOpen ? content.scrollHeight + 'px' : '0px'
  }, [isOpen])

  useEffect(() => {
    updateHeight()
  }, [isOpen, events, toolResults, updateHeight])

  if (!events || events.length === 0) return null

  const processEvents = events.filter(e => e.type !== 'content')
  const status = getTimelineStatus(events, toolResults, isStreaming)
  const timelineItems: Array<TimelineEvent | TimelineEvent[]> = []
  for (let i = 0; i < processEvents.length; i++) {
    const event = processEvents[i]
    if (event.type !== 'tool_call') {
      timelineItems.push(event)
      continue
    }

    const group = [event]
    while (i + 1 < processEvents.length && processEvents[i + 1].type === 'tool_call') {
      group.push(processEvents[i + 1])
      i += 1
    }
    timelineItems.push(group)
  }

  return (
    <div className="w-full flex flex-col relative px-2">
      <div className="absolute left-5 top-0 bottom-0 w-px bg-border/50" />
      <div className="space-y-4">
        {timelineItems.map((item, idx) => {
          if (Array.isArray(item)) {
            if (item.length === 1) {
              const event = item[0]
              const toolResult = toolResults.find(tr => tr.toolCallId === event.toolCallId)
              return <ToolCallItem key={`${event.toolCallId}-${idx}`} event={event} toolResult={toolResult} />
            }
            return <ToolCallGroupItem key={`tool-group-${item[0]?.toolCallId || idx}`} events={item} toolResults={toolResults} />
          }
          const event = item
          if (event.type === 'thinking') {
            return (
              <div key={`${event.timestamp}-${idx}`} className="flex gap-3 min-w-0 relative overflow-hidden">
                <div className="flex flex-col items-center flex-shrink-0 z-10">
                  <div className="w-6 h-6 rounded-full bg-accent/10 border border-border flex items-center justify-center">
                    <Brain className="w-3 h-3 text-accent" />
                  </div>
                </div>
                <div className="flex-1 min-w-0 bg-secondary/20 border border-border/50 rounded-sm px-3 py-2 max-w-full">
                  <div className="text-sm text-muted-foreground break-words overflow-x-hidden">
                    <MarkdownRenderer content={event.content} />
                  </div>
                </div>
              </div>
            )
          }
          return null
        })}
        {status.kind === 'done' && (
          <div className="flex gap-3 min-w-0 relative pt-2">
            <div className="flex flex-col items-center flex-shrink-0 z-10">
              <div className="w-6 h-6 rounded-full bg-green-500/10 border border-border flex items-center justify-center">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0 flex items-center">
              <div className="text-sm font-medium text-foreground">Response generated</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
