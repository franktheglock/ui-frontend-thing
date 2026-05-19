import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { cn } from '../lib/utils'

interface SourcesBlockProps {
  urls: string[]
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
}

export function SourcesBlock({ urls }: SourcesBlockProps) {
  const [isOpen, setIsOpen] = useState(false)

  const uniqueSources = useMemo(() => {
    const seen = new Set<string>()
    return urls.filter((url) => {
      const domain = getDomain(url)
      if (seen.has(domain)) return false
      seen.add(domain)
      return true
    }).map((url) => ({
      url,
      domain: getDomain(url),
      favicon: getFaviconUrl(getDomain(url)),
    }))
  }, [urls])

  if (uniqueSources.length === 0) return null

  const previewSources = uniqueSources.slice(0, 3)

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group"
      >
        <span className="font-medium">Sources</span>
        <div className="flex items-center">
          {previewSources.map((source, i) => (
            <div
              key={source.domain}
              className={cn(
                "w-5 h-5 rounded-full border-2 border-background bg-secondary flex items-center justify-center overflow-hidden",
                i > 0 && "-ml-2"
              )}
              style={{ zIndex: previewSources.length - i }}
            >
              <img
                src={source.favicon}
                alt=""
                className="w-3.5 h-3.5"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          ))}
          {uniqueSources.length > 3 && (
            <div
              className="w-5 h-5 rounded-full border-2 border-background bg-secondary flex items-center justify-center text-[8px] text-muted-foreground font-mono -ml-2"
              style={{ zIndex: 0 }}
            >
              +{uniqueSources.length - 3}
            </div>
          )}
        </div>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-2 border border-border/60 bg-secondary/10 rounded-sm overflow-hidden">
              {uniqueSources.map((source, i) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 hover:bg-secondary/40 transition-colors text-sm text-foreground",
                    i < uniqueSources.length - 1 && "border-b border-border/30"
                  )}
                >
                  <img
                    src={source.favicon}
                    alt=""
                    className="w-4 h-4 rounded-sm flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  <span className="truncate flex-1 min-w-0">{source.domain}</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                </a>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
