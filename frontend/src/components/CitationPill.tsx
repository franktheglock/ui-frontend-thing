import { useChatStore } from '../stores/chatStore'
import { cn } from '../lib/utils'

interface CitationPillProps {
  n: string
}

export function CitationPill({ n }: CitationPillProps) {
  const { sessions, currentSessionId } = useChatStore()
  const sourceIndex = parseInt(n, 10)

  // Extract all URLs from ALL tool results in the session in order
  const urls: string[] = []
  const session = sessions.find(s => s.id === currentSessionId)
  const targetMessages = session?.messages || []

  for (const msg of targetMessages) {
    if (msg.toolResults) {
      for (const result of msg.toolResults) {
        const resultText = typeof result.result === 'string' ? result.result : JSON.stringify(result.result)
        const urlRegex = /URL:\s*(https?:\/\/[^\s]+)/g
        let match
        while ((match = urlRegex.exec(resultText)) !== null) {
          urls.push(match[1])
        }

        // Fallback for read_url results that don't contain a URL line (legacy format)
        if (!/URL:\s*(https?:\/\/[^\s]+)/.test(resultText) && (result.name === 'read_url' || result.name === 'read_browser_page')) {
          const toolCall = msg.toolCalls?.find(tc => tc.id === result.toolCallId)
          if (toolCall) {
            const args = typeof toolCall.arguments === 'string' ? JSON.parse(toolCall.arguments) : toolCall.arguments
            if (args.url) urls.push(args.url)
          }
        }
      }
    }
  }

  const targetUrl = urls[sourceIndex - 1]

  if (!targetUrl) {
    return (
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-destructive/10 text-destructive text-[10px] font-bold mx-0.5 align-middle border border-destructive/20"
        title="Source not found"
      >
        {n}
      </span>
    )
  }

  let domain = targetUrl
  try {
    domain = new URL(targetUrl).hostname.replace('www.', '')
  } catch {}

  return (
    <a
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center justify-center relative",
        "w-6 h-6 rounded-full",
        "bg-accent/10 hover:bg-accent/20",
        "border border-accent/20",
        "transition-all mx-0.5 align-middle no-underline group"
      )}
      title={domain}
    >
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt=""
        className="w-4 h-4 rounded-sm"
      />
      <span
        className={cn(
          "absolute -top-1 -right-1",
          "min-w-[16px] h-[16px] px-0.5",
          "flex items-center justify-center",
          "rounded-full bg-background text-accent",
          "text-[9px] font-bold leading-none",
          "border border-accent/20",
          "shadow-sm"
        )}
      >
        {n}
      </span>
    </a>
  )
}
