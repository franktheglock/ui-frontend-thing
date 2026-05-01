import React, { useState } from 'react'
import { User, Copy, Check, Terminal, RotateCcw, ChevronLeft, ChevronRight, FileText, Download, ExternalLink } from 'lucide-react'
import { Message, GenerationInfo as GenInfo, Attachment } from '../stores/chatStore'
import { ToolCallBlock } from './ToolCallBlock'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ThinkingBlock } from './ThinkingBlock'
import { GenerationInfo } from './GenerationInfo'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { cn } from '../lib/utils'
import { getActivitySublabel } from '../lib/toolDisplay'
import { getProviderIcon } from '../lib/providerIcons'

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const isImage = attachment.type === 'image' || attachment.mimeType?.startsWith('image/')
  const isPdf = attachment.mimeType === 'application/pdf' || attachment.name?.toLowerCase().endsWith('.pdf')

  if (isImage) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block max-w-xs rounded-sm overflow-hidden border border-border hover:border-accent transition-colors group"
      >
        <img src={attachment.url} alt={attachment.name} className="w-full h-auto max-h-48 object-cover" />
      </a>
    )
  }

  if (isPdf) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-3 py-2 bg-secondary/50 border border-border rounded-sm hover:border-accent transition-colors group max-w-xs"
      >
        <div className="w-10 h-10 rounded-sm bg-red-500/10 flex items-center justify-center flex-shrink-0">
          <FileText className="w-5 h-5 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{attachment.name}</p>
          <p className="text-xs text-muted-foreground">PDF Document</p>
        </div>
        <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      </a>
    )
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-3 py-2 bg-secondary/50 border border-border rounded-sm hover:border-accent transition-colors group max-w-xs"
    >
      <div className="w-10 h-10 rounded-sm bg-accent/10 flex items-center justify-center flex-shrink-0">
        <FileText className="w-5 h-5 text-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{attachment.name}</p>
        <p className="text-xs text-muted-foreground">{attachment.mimeType?.split('/')[1]?.toUpperCase() || 'File'}</p>
      </div>
      <Download className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </a>
  )
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(regex)
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-accent/30 text-inherit rounded-sm px-0.5">{part}</mark>
      : part
  )
}

interface MessageBubbleProps {
  message: Message
  searchHighlight?: string | null
  hideTools?: boolean
  aggregatedGenInfo?: GenInfo
  onRegenerate?: () => void
  versionInfo?: { current: number, total: number, onPrev: () => void, onNext: () => void }
}

export function MessageBubble({ 
  message, 
  searchHighlight, 
  hideTools = false, 
  aggregatedGenInfo,
  onRegenerate,
  versionInfo
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const { toolDisplayMode } = useSettingsStore()

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const showContent = message.content && (
    !message.toolCalls || 
    message.toolCalls.length === 0 ||
    message.content.length > 100
  )

  return (
    <div className={cn(
      'group flex items-start gap-3',
      isUser ? 'flex-row-reverse' : 'flex-row'
    )}>
      <div className={cn(
        'w-7 h-7 rounded-none flex items-center justify-center flex-shrink-0 mt-1',
        isUser ? 'bg-primary border border-primary-foreground/20' : 'bg-transparent'
      )}>
        {isUser ? (
          <User className="w-4 h-4 text-primary-foreground" />
        ) : (() => {
          const info = aggregatedGenInfo || message.generationInfo
          const ProviderIcon = getProviderIcon(info ? `${info.provider}/${info.model}` : 'bot')
          return <ProviderIcon size={18} className="text-accent" />
        })()}
      </div>

      <div className={cn('flex-1 space-y-2 min-w-0', isUser ? 'flex flex-col items-end' : '')}>
        {!isUser && message.timeline && message.timeline.length > 0 && toolDisplayMode === 'timeline' && (
          (() => {
            const start = message.timeline[0].timestamp
            const end = message.timeline[message.timeline.length - 1].timestamp
            const duration = Math.round((end - start) / 1000)
            const sublabel = getActivitySublabel(message.timeline, message.toolResults || [])
            const label = duration > 0 ? `Worked for ${duration}s` : 'Worked for <1s'
            
            return (
              <button
                onClick={() => {
                  useUIStore.getState().setActiveActivityMessageId(message.id)
                  useUIStore.getState().setActivityPanelOpen(true)
                }}
                className="transition-colors mb-2 text-[15px] text-muted-foreground hover:text-foreground w-fit font-medium"
              >
                <div className="flex items-center gap-1.5">
                  <span>{label}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/70 flex-shrink-0" />
                </div>
                {sublabel && <span className="text-xs text-muted-foreground/70 truncate max-w-[240px] block mt-0.5">{sublabel}</span>}
              </button>
            )
          })()
        )}

        {!isUser && message.thinking && toolDisplayMode !== 'timeline' && (
          <ThinkingBlock thinking={message.thinking} done />
        )}

        {!isUser && message.toolCalls && message.toolCalls.length > 0 && !hideTools && toolDisplayMode !== 'timeline' && (
          <div className="space-y-2 mb-2">
            {toolDisplayMode === 'grouped' ? (
              (() => {
                const getToolType = (name: string) => {
                  if (name === 'web_search') return 'search'
                  if (name === 'read_url' || name === 'read_browser_page') return 'browse'
                  if (name === 'python' || name === 'terminal') return 'code'
                  return name
                }
                const groups: { type: string, calls: any[], results: any[] }[] = []
                let currentGroup: { type: string, calls: any[], results: any[] } | null = null
                message.toolCalls!.forEach(tc => {
                  const result = message.toolResults?.find(tr => tr.toolCallId === tc.id)
                  const type = getToolType(tc.name)
                  if (currentGroup && currentGroup.type === type) {
                    currentGroup.calls.push(tc)
                    if (result) currentGroup.results.push(result)
                  } else {
                    currentGroup = { type, calls: [tc], results: result ? [result] : [] }
                    groups.push(currentGroup)
                  }
                })
                return groups.map((group, idx) => (
                  <ToolCallBlock key={`${group.type}-${idx}`} toolCalls={group.calls} results={group.results} />
                ))
              })()
            ) : (
              message.toolCalls.map(tc => {
                const result = message.toolResults?.find(tr => tr.toolCallId === tc.id)
                return <ToolCallBlock key={tc.id} toolCalls={[tc]} results={result ? [result] : []} />
              })
            )}
          </div>
        )}

        {showContent && message.content && (
          <div className="relative max-w-full">
            <div className={cn(
              'relative',
              isUser ? 'bg-primary text-primary-foreground px-4 py-2.5 rounded-none' : 'text-foreground'
            )}>
              {isUser ? (
                <p className="text-sm whitespace-pre-wrap">
                  {searchHighlight ? highlightText(message.content, searchHighlight) : message.content}
                </p>
              ) : (
                <MarkdownRenderer content={message.content} searchHighlight={searchHighlight} />
              )}
            </div>

            {message.attachments && message.attachments.length > 0 && (
              <div className={cn('flex flex-wrap gap-2 mt-2', isUser ? 'justify-end' : '')}>
                {message.attachments.map(a => (
                  <AttachmentPreview key={a.id} attachment={a} />
                ))}
              </div>
            )}

            {/* Action Bar */}
            <div className={cn(
              "flex items-center gap-4 mt-1.5 opacity-0 group-hover:opacity-100 transition-all",
              isUser ? "justify-end mr-1" : "ml-1"
            )}>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={handleCopy}
                  title="Copy content"
                  className={cn(
                    "p-1 rounded-none transition-all",
                    isUser ? "hover:bg-primary/10 text-muted-foreground/40 hover:text-primary" : "hover:bg-secondary text-muted-foreground/40 hover:text-accent"
                  )}
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                
                {!isUser && (
                  <>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(message, null, 2))
                        alert('Raw message JSON copied to clipboard')
                      }}
                      title="Copy raw JSON (Debug)"
                      className="p-1 hover:bg-secondary rounded-none transition-all text-muted-foreground/20 hover:text-accent"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                    </button>
                    {onRegenerate && (
                      <button
                        onClick={onRegenerate}
                        title="Regenerate"
                        className="p-1 hover:bg-secondary rounded-none transition-all text-muted-foreground/40 hover:text-accent"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}
              </div>

              {!isUser && versionInfo && versionInfo.total > 1 && (
                <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-secondary/30 text-[10px] font-mono text-muted-foreground border border-border/30">
                  <button 
                    disabled={versionInfo.current === 1}
                    onClick={versionInfo.onPrev}
                    className="hover:text-accent disabled:opacity-20"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <span className="tabular-nums">{versionInfo.current} / {versionInfo.total}</span>
                  <button 
                    disabled={versionInfo.current === versionInfo.total}
                    onClick={versionInfo.onNext}
                    className="hover:text-accent disabled:opacity-20"
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              )}

              {!isUser && (aggregatedGenInfo || message.generationInfo) && (
                <GenerationInfo info={aggregatedGenInfo || message.generationInfo!} />
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
