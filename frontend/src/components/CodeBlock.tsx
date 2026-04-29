import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, Check, Code, ExternalLink, Eye } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { generateUUID } from '../stores/chatStore'
import { cn } from '../lib/utils'

interface CodeBlockProps {
  language: string
  content: string
  highlighted?: React.ReactNode
}

export function CodeBlock({ language, content, highlighted }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code')
  const { setActiveArtifact, setArtifactPanelOpen } = useUIStore()

  const isPreviewable = ['html', 'svg', 'markdown'].includes(language) || 
    content.includes('<!DOCTYPE html>') || 
    content.includes('<html')

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenArtifact = () => {
    setActiveArtifact({
      id: generateUUID(),
      type: language === 'svg' ? 'svg' : language === 'markdown' ? 'markdown' : 'html',
      title: `Artifact ${language}`,
      language,
      content,
      timestamp: Date.now(),
    })
    setArtifactPanelOpen(true)
  }

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
          <code className={`language-${language} text-sm font-mono`}>
            {highlighted || content}
          </code>
        </pre>
      ) : (
        <div className="p-4 bg-background">
          {language === 'svg' ? (
            <div dangerouslySetInnerHTML={{ __html: content }} />
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
