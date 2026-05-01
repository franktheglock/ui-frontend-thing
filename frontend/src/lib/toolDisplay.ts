import { TimelineEvent, ToolResult } from '../stores/chatStore'

export function getToolDisplay(name: string, args: unknown): string {
  let parsed: Record<string, unknown> = {}
  if (typeof args === 'string') {
    try { parsed = JSON.parse(args) } catch { parsed = {} }
  } else if (args && typeof args === 'object') {
    parsed = args as Record<string, unknown>
  }

  switch (name) {
    case 'web_search': {
      const query =
        parsed.query ??
        parsed.q ??
        parsed.search ??
        parsed.question ??
        parsed.search_query
      if (query) {
        const q = String(query)
        return `Searching the web for "${q.slice(0, 40)}${q.length > 40 ? '…' : ''}"`
      }
      return 'Searching the web'
    }
    case 'read_url':
    case 'read_browser_page': {
      const url = parsed.url ?? parsed.URL ?? parsed.uri ?? parsed.href
      if (url) {
        const u = String(url)
        return `Reading ${u.slice(0, 40)}${u.length > 40 ? '…' : ''}`
      }
      return 'Reading URL'
    }
    case 'python': {
      if (parsed.packages && Array.isArray(parsed.packages) && parsed.packages.length > 0) {
        const pkgs = parsed.packages as string[]
        return `Installing packages: ${pkgs.slice(0, 3).join(', ')}${pkgs.length > 3 ? '…' : ''}`
      }
      const code = parsed.code
      if (code) {
        const firstLine = String(code).split('\n')[0].trim()
        if (firstLine) {
          return `Running: ${firstLine.slice(0, 40)}${firstLine.length > 40 ? '…' : ''}`
        }
      }
      return 'Running Python code'
    }
    case 'code_edit': {
      const file = parsed.file_name ?? parsed.fileName ?? parsed.filename
      if (file) return `Editing ${String(file)}`
      return 'Editing code'
    }
    case 'terminal': {
      const cmd = parsed.command
      if (cmd) {
        const c = String(cmd)
        return `Running: ${c.slice(0, 40)}${c.length > 40 ? '…' : ''}`
      }
      return 'Running terminal command'
    }
    case 'list_skills':
      return 'Listing available skills'
    case 'read_skill': {
      const skill = parsed.skill_name ?? parsed.skillName ?? parsed.name
      if (skill) return `Reading skill: ${String(skill)}`
      return 'Reading skill'
    }
    case 'make_skill': {
      const skill = parsed.skill_name ?? parsed.skillName ?? parsed.name
      if (skill) return `Creating skill: ${String(skill)}`
      return 'Creating skill'
    }
    default:
      return `Using ${name}`
  }
}

export function getActivitySublabel(
  timeline: TimelineEvent[],
  toolResults: ToolResult[]
): string | undefined {
  const processEvents = timeline.filter((e) => e.type !== 'content')
  if (processEvents.length === 0) return undefined

  const lastEvent = processEvents[processEvents.length - 1]

  if (lastEvent.type === 'thinking') {
    const text = lastEvent.content.replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 60) + (text.length > 60 ? '…' : '')
    return 'Thinking'
  }

  if (lastEvent.type === 'tool_call') {
    const hasResult = toolResults.some((r) => r.toolCallId === lastEvent.toolCallId)
    if (!hasResult) {
      if (lastEvent.display) return lastEvent.display
      if (lastEvent.toolArgs) return getToolDisplay(lastEvent.toolName || '', lastEvent.toolArgs)
      return `Using ${lastEvent.toolName || 'tool'}`
    }
    return `Finished ${lastEvent.toolName || 'tool'}`
  }

  if (lastEvent.type === 'tool_result') {
    const isError = lastEvent.content.startsWith('Error:')
    if (isError) return `Error in ${lastEvent.toolName || 'tool'}`
    return `Got result from ${lastEvent.toolName || 'tool'}`
  }

  return undefined
}
