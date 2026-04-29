import React, { useState } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { User, Bot, Copy, Check, FileText, Wrench, Terminal } from 'lucide-react'
import { Message } from '../stores/chatStore'
import { CodeBlock } from './CodeBlock'
import { GenerationInfo } from './GenerationInfo'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { MarkdownRenderer } from './MarkdownRenderer'
import { cn } from '../lib/utils'

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn(
      'group flex items-start gap-3',
      isUser ? 'flex-row-reverse' : 'flex-row'
    )}>
      <div className={cn(
        'w-7 h-7 rounded-none flex items-center justify-center flex-shrink-0 mt-1',
        isUser ? 'bg-primary text-primary-foreground' : 'bg-accent/10 text-accent'
      )}>
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      <div className={cn(
        'flex-1 space-y-2 min-w-0',
        isUser && 'flex flex-col items-end'
      )}>
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.attachments.map(attachment => (
              <div key={attachment.id} className="relative group/attachment">
                {attachment.type === 'image' ? (
                  <div className="relative">
                    <img
                      src={attachment.url.startsWith('http') ? attachment.url : `${window.location.origin}${attachment.url}`}
                      alt={attachment.name}
                      className="max-w-[200px] max-h-[200px] rounded-none border border-border object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-2 py-1 opacity-0 group-hover/attachment:opacity-100 transition-opacity">
                      {attachment.name}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 bg-secondary border border-border rounded-none text-sm">
                    <FileText className="w-4 h-4 text-accent" />
                    <span className="truncate max-w-[150px]">{attachment.name}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!isUser && message.thinking && !message.toolCalls?.length && (
          <ThinkingBlock thinking={message.thinking} done />
        )}

        {message.content && (
          <div className={cn(
            'relative max-w-full',
            isUser ? 'bg-primary text-primary-foreground px-4 py-2.5 rounded-none' : 'text-foreground'
          )}>
            {isUser ? (
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            ) : (
              <MarkdownRenderer content={message.content} />
            )}
            {!isUser && (
              <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-all">
                <button
                  onClick={handleCopy}
                  title="Copy content"
                  className="p-1.5 hover:bg-secondary rounded-none transition-all"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(message, null, 2))
                    alert('Raw message JSON copied to clipboard')
                  }}
                  title="Copy raw JSON (Debug)"
                  className="p-1.5 hover:bg-secondary rounded-none transition-all text-muted-foreground/50 hover:text-accent"
                >
                  <Terminal className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <>
            {message.toolCalls.map(tc => {
              const result = message.toolResults?.find(tr => tr.toolCallId === tc.id)
              return <ToolCallBlock key={tc.id} toolCall={tc} result={result} />
            })}
          </>
        )}

        {!isUser && message.generationInfo && (
          <GenerationInfo info={message.generationInfo} />
        )}
      </div>
    </div>
  )
}
