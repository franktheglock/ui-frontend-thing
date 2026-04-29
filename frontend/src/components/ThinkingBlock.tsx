import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Brain } from 'lucide-react'
import { cn } from '../lib/utils'
import { MarkdownRenderer } from './MarkdownRenderer'

const COLLAPSED_HEIGHT = 72 // 4.5rem in px

interface ThinkingBlockProps {
  thinking: string
  done?: boolean // true when thinking is complete and response has started
}

export function ThinkingBlock({ thinking, done = false }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom in collapsed mode so you see the latest thinking
  useEffect(() => {
    if (!isOpen && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [thinking, isOpen])

  // Measure and apply height for smooth transitions via CSS
  const updateHeight = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    if (isOpen) {
      // Always show full content when expanded
      container.style.height = content.scrollHeight + 'px'
    } else if (done) {
      // Collapsed + done: hide the preview entirely
      container.style.height = '0px'
    } else {
      // Collapsed + still thinking: show small preview
      container.style.height = COLLAPSED_HEIGHT + 'px'
    }
  }, [isOpen])

  useEffect(() => {
    updateHeight()
  }, [isOpen, thinking, updateHeight])

  return (
    <div className="border border-border rounded-none overflow-hidden flex flex-col w-full max-w-2xl">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
          isOpen ? 'bg-secondary' : 'bg-secondary/50 hover:bg-secondary'
        )}
      >
        <Brain className="w-3.5 h-3.5 text-accent" />
        <span className="text-muted-foreground">{done ? 'Thinking Process' : 'Thinking'}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {thinking.length} chars
        </span>
        {isOpen ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>
      <div
        ref={containerRef}
        style={{ height: done ? 0 : COLLAPSED_HEIGHT }}
        className={cn(
          "overflow-hidden border-t border-border bg-secondary/30 relative",
          isOpen ? "transition-[height] duration-300 ease-in-out" : ""
        )}
      >
        <div 
          ref={contentRef}
          className={cn(
            "px-3 py-2 text-sm text-muted-foreground italic",
            isOpen ? "" : "absolute inset-0 overflow-hidden"
          )}
        >
          <MarkdownRenderer content={thinking} />
        </div>
        {!isOpen && (
          <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-secondary/30 to-transparent pointer-events-none" />
        )}
      </div>
    </div>
  )
}
