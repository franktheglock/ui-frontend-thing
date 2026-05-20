import React, { useState, useEffect } from 'react'
import { Copy, Check, Code, ExternalLink, Eye } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { generateUUID } from '../stores/chatStore'
import { cn, copyTextToClipboard } from '../lib/utils'
import hljs from 'highlight.js'

// Memory cache for highlighted code snippets to make switching chats instantaneous. Capped to prevent memory leak.
const highlightCache = new Map<string, string>()
const MAX_CACHE_SIZE = 100

function getHighlightedHtml(content: string, language: string): string {
  const cacheKey = `${language}:${content}`
  if (highlightCache.has(cacheKey)) {
    const val = highlightCache.get(cacheKey)!
    // Move to end (most recently used)
    highlightCache.delete(cacheKey)
    highlightCache.set(cacheKey, val)
    return val
  }

  let html = ''
  try {
    const lang = language.toLowerCase()
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(content, { language: lang }).value
    } else {
      html = hljs.highlightAuto(content).value
    }
  } catch (err) {
    // Fallback: simple HTML escape
    html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  if (highlightCache.size >= MAX_CACHE_SIZE) {
    const firstKey = highlightCache.keys().next().value
    if (firstKey !== undefined) {
      highlightCache.delete(firstKey)
    }
  }
  highlightCache.set(cacheKey, html)
  return html
}

interface CodeBlockProps {
  language: string
  content: string
  highlighted?: React.ReactNode
}

export function CodeBlock({ language, content, highlighted }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code')
  const { setActiveArtifact, setArtifactPanelOpen } = useUIStore()
  const { theme } = useSettingsStore()

  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(() => {
    if (highlighted) return null
    const cacheKey = `${language}:${content}`
    return highlightCache.has(cacheKey) ? highlightCache.get(cacheKey)! : null
  })

  useEffect(() => {
    if (highlighted) return
    const cacheKey = `${language}:${content}`
    if (highlightCache.has(cacheKey)) {
      setHighlightedHtml(highlightCache.get(cacheKey)!)
      return
    }

    const runHighlight = () => {
      const html = getHighlightedHtml(content, language)
      setHighlightedHtml(html)
    }

    // Defer rendering highlighting to keep UI thread responsive
    const timer = setTimeout(runHighlight, 0)
    return () => clearTimeout(timer)
  }, [content, language, highlighted])

  const isPreviewable = ['html', 'svg', 'markdown', 'mermaid'].includes(language) || 
    content.includes('<!DOCTYPE html>') || 
    content.includes('<html')

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy code:', error)
    }
  }

  const handleOpenArtifact = () => {
    setActiveArtifact({
      id: generateUUID(),
      type: language === 'svg' ? 'svg' : language === 'markdown' ? 'markdown' : language === 'mermaid' ? 'code' : 'html',
      title: `Artifact ${language}`,
      language,
      content,
      timestamp: Date.now(),
    })
    setArtifactPanelOpen(true)
  }

  // Generate Mermaid frame contents locally
  const mermaidSrcDoc = React.useMemo(() => {
    if (language !== 'mermaid') return ''
    const isDark = theme !== 'light'
    const mermaidTheme = isDark ? 'dark' : 'default'
    const bgColor = isDark ? '#121212' : '#ffffff'
    const textColor = isDark ? '#e0e0e0' : '#1a1a1a'

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <script src="/mermaid.min.js"></script>
        <style>
          body {
            margin: 0;
            padding: 16px;
            background-color: ${bgColor};
            color: ${textColor};
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
            font-family: system-ui, -apple-system, sans-serif;
            box-sizing: border-box;
            overflow: auto;
          }
          .mermaid {
            opacity: 0;
            transition: opacity 0.3s ease-in-out;
            max-width: 100%;
          }
          .mermaid[data-processed="true"] {
            opacity: 1;
          }
          #error-container {
            display: none;
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.2);
            background: rgba(239, 68, 68, 0.05);
            padding: 16px;
            font-family: monospace;
            font-size: 13px;
            max-width: 600px;
            margin: auto;
            border-radius: 4px;
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>
        <div id="error-container"></div>
        <div class="mermaid">
${content}
        </div>
        <script>
          window.addEventListener('error', function(e) {
            const errDiv = document.getElementById('error-container');
            if (errDiv) {
              errDiv.style.display = 'block';
              errDiv.textContent = 'Mermaid syntax error:\\n' + e.message;
            }
          });
          try {
            mermaid.initialize({
              startOnLoad: true,
              theme: '${mermaidTheme}',
              securityLevel: 'loose',
              themeVariables: {
                background: '${bgColor}',
                primaryColor: '${isDark ? '#1f2937' : '#f3f4f6'}',
              }
            });
          } catch (err) {
            const errDiv = document.getElementById('error-container');
            if (errDiv) {
              errDiv.style.display = 'block';
              errDiv.textContent = 'Failed to initialize Mermaid:\\n' + err.message;
            }
          }
        </script>
      </body>
      </html>
    `
  }, [content, language, theme])

  return (
    <div className="my-4 rounded-sm border border-border overflow-hidden bg-secondary/50">
      <div className="flex items-center justify-between px-3 py-2 bg-secondary border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground uppercase">{language || 'text'}</span>
          {isPreviewable && (
            <div className="flex items-center gap-0.5 bg-background rounded-sm p-0.5">
              <button
                onClick={() => setViewMode('code')}
                className={cn(
                  'p-1 rounded-sm transition-colors',
                  viewMode === 'code' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Code className="w-3 h-3" />
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={cn(
                  'p-1 rounded-sm transition-colors',
                  viewMode === 'preview' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Eye className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isPreviewable && (
            <button
              onClick={handleOpenArtifact}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded-sm transition-colors"
              title="Open in sidebar"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded-sm transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {viewMode === 'code' ? (
        <pre className="p-4 overflow-x-auto">
          {highlighted ? (
            <code className={`language-${language} text-sm font-mono`}>
              {highlighted}
            </code>
          ) : highlightedHtml ? (
            <code 
              className={`language-${language} text-sm font-mono hljs`}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <code className={`language-${language} text-sm font-mono`}>
              {content}
            </code>
          )}
        </pre>
      ) : (
        <div className="p-4 bg-background">
          {language === 'svg' ? (
            <div dangerouslySetInnerHTML={{ __html: content }} />
          ) : language === 'mermaid' ? (
            <iframe
              srcDoc={mermaidSrcDoc}
              className="w-full h-[300px] border-0 rounded-sm bg-[#121212] dark:bg-[#121212]"
              sandbox="allow-scripts"
              title="Mermaid Flowchart Preview"
            />
          ) : (
            <iframe
              srcDoc={content}
              className="w-full h-[300px] border-0 rounded-sm"
              sandbox="allow-scripts"
            />
          )}
        </div>
      )}
    </div>
  )
}
