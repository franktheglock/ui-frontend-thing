import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { CodeBlock } from './CodeBlock'
import { CitationPill } from './CitationPill'
import { Message, useChatStore } from '../stores/chatStore'
import { cn } from '../lib/utils'

function extractText(node: any): string {
  if (!node) return ''
  if (node.type === 'text') {
    return node.value || ''
  }
  if (node.children && Array.isArray(node.children)) {
    return node.children.map(extractText).join('')
  }
  return ''
}

/** Extract flat text from React children. */
function getChildrenText(children: React.ReactNode): string {
  if (children === null || children === undefined || typeof children === 'boolean') return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(getChildrenText).join('')
  return ''
}

/** Extract all URLs from tool results across ALL messages in a session. */
function getCitationUrls(messages: Message[]): string[] {
  const urls: string[] = []

  for (const message of messages) {
    if (!message.toolResults) continue

    for (const tr of message.toolResults) {
      const resultText = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)

      // Extract URLs from web_search results
      const urlRegex = /URL:\s*(https?:\/\/[^\s]+)/g
      let match
      while ((match = urlRegex.exec(resultText)) !== null) {
        urls.push(match[1])
      }

      // For read_url without a URL line, fall back to tool call arguments
      const hasUrlLine = /URL:\s*https?:\/\//.test(resultText)
      if (!hasUrlLine && (tr.name === 'read_url' || tr.name === 'read_browser_page')) {
        const toolCall = message.toolCalls?.find(tc => tc.id === tr.toolCallId)
        if (toolCall) {
          const args = typeof toolCall.arguments === 'string' ? JSON.parse(toolCall.arguments) : toolCall.arguments
          if (args.url) urls.push(args.url)
        }
      }
    }
  }

  return urls
}

/** Build a markdown link for a single citation index, or plain text if no URL. */
function citationLink(index: number, urls: string[]): string {
  const url = urls[index - 1]
  if (!url) return `[${index}]`
  return `[[${index}]](${url})`
}

/** Pre-process content: convert every citation syntax into a markdown link [[N]](url). */
function preprocessCitations(content: string, urls: string[]): string {
  let s = content

  // --------------------------------------------------------------------------
  // PASS 1 – Replace every citation pattern with a temporary token {{CITE:N}}.
  // --------------------------------------------------------------------------

  // Helper for multi-number patterns
  const multiToken = (match: string): string => {
    const nums = match.match(/\d+/g)
    return nums ? nums.map((n) => `{{CITE:${n}}}`).join(', ') : match
  }

  // 1. Prioritize Multi-number patterns (they contain commas or multiple numbers)
  s = s.replace(/【\s*(?:[Ss][Oo][Uu][Rr][Cc][Ee]\s*[: ]\s*)?\d+(?:\s*,\s*(?:[Ss][Oo][Uu][Rr][Cc][Ee]\s*[: ]\s*)?\d+)*\s*】/g, multiToken)
  s = s.replace(/\[\s*(?:[Ss][Oo][Uu][Rr][Cc][Ee]\s*[: ]\s*)?\d+(?:\s*,\s*(?:[Ss][Oo][Uu][Rr][Cc][Ee]\s*[: ]\s*)?\d+)*\s*\]/g, multiToken)
  s = s.replace(/\(\s*(?:[Ss][Oo][Uu][Rr][Cc][Ee]\s*[: ]\s*)?\d+(?:\s*,\s*(?:[Ss][Oo][Uu][Rr][Cc][Ee]\s*[: ]\s*)?\d+)*\s*\)/g, multiToken)

  // 2. Handle single citation patterns
  // Fullwidth brackets with source label: 【source:11】 or 【Source 11】
  s = s.replace(/【\s*[Ss][Oo][Uu][Rr][Cc][Ee]\s*[: ]\s*(\d+)\s*】/g, '{{CITE:$1}}')

  // Fullwidth bare brackets: 【11】
  s = s.replace(/【\s*(\d+)\s*】/g, '{{CITE:$1}}')

  // ASCII square brackets with source label: [source:11] or [Source 11]
  s = s.replace(/\[\s*[Ss][Oo][Uu][Rr][Cc][Ee]\s*[: ]\s*(\d+)\s*\]/g, '{{CITE:$1}}')

  // ASCII bare brackets: [11]
  s = s.replace(/\[\s*(\d+)\s*\]/g, '{{CITE:$1}}')

  // Parenthesised with source label: (source:11) or (Source 11)
  s = s.replace(/\(\s*[Ss][Oo][Uu][Rr][Cc][Ee]\s*[: ]\s*(\d+)\s*\)/g, '{{CITE:$1}}')

  // Parenthesised bare: (11)
  s = s.replace(/\(\s*(\d+)\s*\)/g, '{{CITE:$1}}')

  // Fullwidth parentheses: （11）
  s = s.replace(/（\s*(\d+)\s*）/g, '{{CITE:$1}}')

  // Standalone "source:N" at word boundary
  s = s.replace(/\b[Ss][Oo][Uu][Rr][Cc][Ee]\s*[: ]\s*(\d+)\b/g, '{{CITE:$1}}')

  // --------------------------------------------------------------------------
  // PASS 2 – Convert tokens to real markdown links.
  // --------------------------------------------------------------------------
  s = s.replace(/\{\{CITE:(\d+)\}\}/g, (_m, n) => citationLink(parseInt(n, 10), urls))

  return s
}

interface MarkdownRendererProps {
  content: string
  streaming?: boolean
  searchHighlight?: string | null
}

function ImageWithLightbox({ src, alt, ...props }: any) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [isHovered, setIsHovered] = React.useState(false)

  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    if (isOpen) window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen])

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const response = await fetch(src)
      const blob = await response.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy image:', err)
    }
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    const link = document.createElement('a')
    link.href = src
    link.download = alt || 'image.png'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div 
      className="relative my-4 inline-flex max-w-full group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative overflow-hidden border border-border/50">
        <img 
          src={src} 
          alt={alt}
          {...props} 
          onClick={() => setIsOpen(true)}
          className="block max-w-full h-auto cursor-zoom-in hover:scale-[1.01] transition-transform duration-300 m-0" 
          loading="lazy"
        />
        
        <div className={`absolute bottom-0 left-0 right-0 p-2 bg-background/90 backdrop-blur-sm border-t border-border/50 transition-transform duration-200 flex items-center justify-between gap-4 ${isHovered ? 'translate-y-0' : 'translate-y-full'}`}>
          <span className="text-[10px] font-mono uppercase tracking-tighter text-foreground/40 truncate">
            {alt || 'IMAGE_ASSET'}
          </span>
          <div className="flex gap-2 shrink-0">
            <button 
              onClick={handleCopy}
              className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 bg-secondary hover:bg-primary hover:text-primary-foreground transition-colors border border-border/50 whitespace-nowrap"
            >
              {copied ? '[ COPIED ]' : '[ COPY ]'}
            </button>
            <button 
              onClick={handleDownload}
              className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 bg-secondary hover:bg-primary hover:text-primary-foreground transition-colors border border-border/50 whitespace-nowrap"
            >
              {saved ? '[ SAVED ]' : '[ SAVE ]'}
            </button>
          </div>
        </div>
      </div>

      {isOpen && (
        <div 
          className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-12 cursor-zoom-out animate-in fade-in duration-200"
          onClick={() => setIsOpen(false)}
        >
          <div className="relative max-w-full max-h-full">
            <img 
              src={src} 
              alt={alt}
              className="max-w-full max-h-[90vh] object-contain border border-border shadow-2xl bg-secondary"
            />
            <button 
              className="absolute -top-12 right-0 text-foreground/60 hover:text-foreground text-sm font-mono uppercase tracking-widest"
              onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
            >
              [ Close ]
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function MarkdownRenderer({ content, streaming = false, searchHighlight }: MarkdownRendererProps) {
  const { sessions, currentSessionId, streaming: liveStreaming } = useChatStore()
  const session = sessions.find(s => s.id === currentSessionId)
  const allMessages = session?.messages || []
  const liveState = currentSessionId ? liveStreaming[currentSessionId] : null

  const urls = React.useMemo(() => {
    const sessionUrls = getCitationUrls(allMessages)
    if (!streaming || !liveState) return sessionUrls

    const liveUrls = getCitationUrls([
      ...allMessages,
      {
        id: '__stream__',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: liveState.toolCalls,
        toolResults: liveState.toolResults,
      } as Message
    ])

    return [...sessionUrls, ...liveUrls]
  }, [allMessages, liveState, streaming])
  const processedContent = React.useMemo(
    () => preprocessCitations(content, urls),
    [content, urls]
  )

  const cleanedContent = processedContent.replace(/\(\s*(```[\s\S]*?```)\s*\)/g, '$1')

  const components = React.useMemo(() => ({
    text({ children }: any) {
      if (!searchHighlight || typeof children !== 'string') return children
      const query = searchHighlight.toLowerCase()
      const parts = children.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
      return (
        <>
          {parts.map((part, i) => 
            part.toLowerCase() === query 
              ? <mark key={i} className="bg-accent/30 text-inherit rounded-sm px-0.5">{part}</mark>
              : part
          )}
        </>
      )
    },
    a({ node, children, href, ...props }: any) {
      const label = getChildrenText(children)
      const citationMatch = label.match(/^\[(\d+)\]$/)
      if (citationMatch) {
        return <CitationPill n={citationMatch[1]} urls={urls} />
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      )
    },
    img({ node, src, ...props }: any) {
      let finalSrc = src
      if (src && !src.startsWith('http') && !src.startsWith('/') && !src.startsWith('data:')) {
        const cleanPath = src.replace(/^\.\/output\//, '').replace(/^\.\//, '').replace(/^output\//, '')
        finalSrc = `/uploads/python-out/${cleanPath}`
      }
      return <ImageWithLightbox src={finalSrc} {...props} />
    },
    table({ children, ...props }: any) {
      return (
        <div className="overflow-x-auto -mx-1 px-1">
          <table {...props}>{children}</table>
        </div>
      )
    },
    pre({ children, ...props }: any) {
      const codeChild = React.Children.toArray(children).find(
        (child) => React.isValidElement(child) && child.props.node?.tagName === 'code'
      ) as React.ReactElement | undefined

      if (codeChild) {
        const childProps = codeChild.props as any
        const match = /language-(\w+)/.exec(childProps.className || '')
        const language = match ? match[1] : ''
        
        const rawText = childProps.node ? extractText(childProps.node) : getChildrenText(childProps.children)
        
        const isPlainText = !language || language === 'text' || language === 'txt'
        if (isPlainText) {
          return (
            <pre className="my-0 p-3 bg-secondary/40 border border-border/50 rounded-sm overflow-x-auto text-sm font-mono text-foreground/90 whitespace-pre-wrap" {...props}>
              {childProps.children}
            </pre>
          )
        }

        return (
          <CodeBlock
            language={language}
            content={rawText.replace(/\n$/, '')}
            highlighted={childProps.children}
          />
        )
      }
      return <pre {...props}>{children}</pre>
    },
    code({ node, className, children, ...props }: any) {
      // Since block code is intercepted by the `pre` renderer above, 
      // anything that renders here is inline code (or will have this wrapper discarded by `pre`).
      return (
        <code className={cn("!inline-block bg-secondary/60 px-1.5 py-0.5 rounded-sm text-[0.85em] font-mono align-baseline break-words", className)} {...props}>
          {children}
        </code>
      )
    },
  }), [searchHighlight])

  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none break-words", streaming && "streaming-fade")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false }], ...(streaming ? [] : [rehypeHighlight])]}
        components={components}
      >
        {cleanedContent}
      </ReactMarkdown>
    </div>
  )
}
