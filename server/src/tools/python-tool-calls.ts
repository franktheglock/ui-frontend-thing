/**
 * LFM-style tool call parser.
 *
 * LFM models output tool calls inline in the content stream using
 * special delimiter tokens. Two formats are supported:
 *
 * 1. Pythonic (default): <|tool_call_start|>[func_name(param="value")]<|tool_call_end|>
 * 2. JSON (with "Output function calls as JSON" prompt): <|tool_call_start|>{"name":"func","arguments":{}}<|tool_call_end|>
 *
 * Both use the same <|tool_call_start|> / <|tool_call_end|> tokens.
 *
 * Reference: https://docs.liquid.ai/lfm/key-concepts/tool-use
 */

// Matches content between <|tool_call_start|> and <|tool_call_end|>
const TOOL_CALL_BLOCK = /<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>/gi

/**
 * Try to parse content as a JSON tool call: {"name": "...", "arguments": {...}}
 */
function tryParseJsonToolCall(raw: string): { name: string; arguments: Record<string, unknown> } | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed)
    const name = parsed.name || parsed.function || parsed.func
    const args = parsed.arguments || parsed.params || parsed.parameters || parsed.args || {}
    if (name && typeof name === 'string') {
      return {
        name,
        arguments: typeof args === 'string' ? safeJsonParse(args) : args,
      }
    }
  } catch {}
  return null
}

/**
 * Try to parse content as a Pythonic tool call: [func_name(param="value")]
 * e.g. [web_search(query='K-pop Demon Hunters 2', num_results=5)]
 */
function tryParsePythonicToolCall(raw: string): { name: string; arguments: Record<string, unknown> } | null {
  const trimmed = raw.trim()
  // Must start with [ and contain (
  if (!trimmed.startsWith('[')) return null
  const inner = trimmed.slice(1, trimmed.lastIndexOf(']') > 0 ? trimmed.lastIndexOf(']') : undefined)
  if (!inner) return null

  // Find the first ( to separate function name from args
  const parenIdx = inner.indexOf('(')
  if (parenIdx === -1) return null
  const name = inner.slice(0, parenIdx).trim()
  if (!name) return null

  const argsStr = inner.slice(parenIdx + 1, inner.lastIndexOf(')') > 0 ? inner.lastIndexOf(')') : undefined)
  const args = argsStr ? parsePythonKwargs(argsStr) : {}

  return { name, arguments: args }
}

/**
 * Extract tool calls from a content string, handling both Pythonic and JSON formats
 * inside <|tool_call_start|> / <|tool_call_end|> tokens.
 *
 * Returns cleaned content (tokens removed) and tool calls in standard format.
 */
export function extractPythonToolCalls(content: string): {
  cleanedContent: string
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[]
} {
  const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = []
  let cleanedContent = content
  let match: RegExpExecArray | null
  let callIndex = 0

  TOOL_CALL_BLOCK.lastIndex = 0

  while ((match = TOOL_CALL_BLOCK.exec(content)) !== null) {
    const raw = match[1].trim()
    if (!raw) {
      cleanedContent = cleanedContent.replace(match[0], '')
      continue
    }

    // Try JSON format first (starts with {), then Pythonic format (starts with [)
    const parsed = tryParseJsonToolCall(raw) || tryParsePythonicToolCall(raw)

    if (parsed) {
      toolCalls.push({
        id: `call_${Date.now()}_${callIndex++}`,
        name: parsed.name,
        arguments: parsed.arguments,
      })
      cleanedContent = cleanedContent.replace(match[0], '')
    } else {
      // Unrecognized content inside tokens — strip tokens, keep inner content
      cleanedContent = cleanedContent.replace(match[0], raw)
    }
  }

  return { cleanedContent: cleanedContent.trim(), toolCalls }
}

/**
 * Check if a content string contains any LFM-style tool call markers.
 */
export function hasPythonToolCalls(content: string): boolean {
  TOOL_CALL_BLOCK.lastIndex = 0
  return TOOL_CALL_BLOCK.test(content)
}

// ─── Python kwargs parser (for Pythonic format) ──────────────────────────────

function parsePythonKwargs(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (!text || !text.trim()) return result

  const tokens = splitTopLevelCommas(text.trim())
  for (const token of tokens) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const eqIdx = findTopLevelEquals(trimmed)
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const valueStr = trimmed.slice(eqIdx + 1).trim()
    if (key) result[key] = parsePythonValue(valueStr)
  }
  return result
}

function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let inSingle = false
  let inDouble = false
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const prev = i > 0 ? text[i - 1] : ''
    if (c === "'" && !inDouble && prev !== '\\') { inSingle = !inSingle; continue }
    if (c === '"' && !inSingle && prev !== '\\') { inDouble = !inDouble; continue }
    if (inSingle || inDouble) continue
    if (c === '(' || c === '[' || c === '{') { depth++; continue }
    if (c === ')' || c === ']' || c === '}') { depth--; continue }
    if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  const remaining = text.slice(start).trim()
  if (remaining) parts.push(remaining)
  return parts
}

function findTopLevelEquals(text: string): number {
  let depth = 0; let inSingle = false; let inDouble = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const prev = i > 0 ? text[i - 1] : ''
    if (c === "'" && !inDouble && prev !== '\\') { inSingle = !inSingle; continue }
    if (c === '"' && !inSingle && prev !== '\\') { inDouble = !inDouble; continue }
    if (inSingle || inDouble) continue
    if (c === '(' || c === '[' || c === '{') { depth++; continue }
    if (c === ')' || c === ']' || c === '}') { depth--; continue }
    if (c === '=' && depth === 0) return i
  }
  return -1
}

function parsePythonValue(value: string): unknown {
  value = value.trim()
  if (!value) return ''
  if (value === 'None' || value === 'null' || value === 'undefined') return null
  if (value === 'True') return true
  if (value === 'False') return false
  if (value.startsWith("'")) {
    const inner = value.slice(1); const endIdx = inner.lastIndexOf("'")
    return unescapePythonString(endIdx >= 0 ? inner.slice(0, endIdx) : inner)
  }
  if (value.startsWith('"')) {
    const inner = value.slice(1); const endIdx = inner.lastIndexOf('"')
    return unescapePythonString(endIdx >= 0 ? inner.slice(0, endIdx) : inner)
  }
  if (value.startsWith('[')) {
    const inner = value.slice(1, value.lastIndexOf(']') > 0 ? value.lastIndexOf(']') : undefined)
    if (!inner || !inner.trim()) return []
    return splitTopLevelCommas(inner.trim()).map(item => parsePythonValue(item.trim()))
  }
  if (value.startsWith('{')) {
    const inner = value.slice(1, value.lastIndexOf('}') > 0 ? value.lastIndexOf('}') : undefined)
    if (!inner || !inner.trim()) return {}
    const result: Record<string, unknown> = {}
    const entries = splitTopLevelCommas(inner.trim())
    for (const entry of entries) {
      const colonIdx = findTopLevelColon(entry.trim())
      if (colonIdx === -1) continue
      const k = entry.slice(0, colonIdx).trim()
      const v = entry.slice(colonIdx + 1).trim()
      if (k) {
        const key = (k.startsWith("'") || k.startsWith('"')) ? String(parsePythonValue(k)) : k
        result[key] = parsePythonValue(v)
      }
    }
    return result
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    return value.includes('.') ? parseFloat(value) : parseInt(value, 10)
  }
  return value
}

function findTopLevelColon(text: string): number {
  let depth = 0; let inSingle = false; let inDouble = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const prev = i > 0 ? text[i - 1] : ''
    if (c === "'" && !inDouble && prev !== '\\') { inSingle = !inSingle; continue }
    if (c === '"' && !inSingle && prev !== '\\') { inDouble = !inDouble; continue }
    if (inSingle || inDouble) continue
    if (c === '(' || c === '[' || c === '{') { depth++; continue }
    if (c === ')' || c === ']' || c === '}') { depth--; continue }
    if (c === ':' && depth === 0) return i
  }
  return -1
}

function unescapePythonString(s: string): string {
  return s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
}

function safeJsonParse(text: string): Record<string, unknown> {
  try { return JSON.parse(text) } catch { return {} }
}
