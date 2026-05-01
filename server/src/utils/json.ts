export function repairJson(json: string): string {
  let s = json.trim()
  if (!s) return '{}'

  // Replace single quotes with double quotes (but not inside strings)
  s = s.replace(/'([^']*)'/g, '"$1"')

  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1')

  // Add missing closing braces/brackets
  let openBraces = 0, openBrackets = 0
  let inString = false, escapeNext = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (escapeNext) { escapeNext = false; continue }
    if (c === '\\') { escapeNext = true; continue }
    if (c === '"' && !escapeNext) { inString = !inString; continue }
    if (inString) continue
    if (c === '{') openBraces++
    else if (c === '}') openBraces--
    else if (c === '[') openBrackets++
    else if (c === ']') openBrackets--
  }
  while (openBrackets > 0) { s += ']'; openBrackets-- }
  while (openBraces > 0) { s += '}'; openBraces-- }

  // Fix unquoted property names: { key: -> { "key":
  s = s.replace(/([{,])\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1 "$2":')

  // Fix missing colon after property name (rare but happens)
  s = s.replace(/"([^"]+)"\s+"([^"]+)"/g, '"$1": "$2"')

  return s
}

export function safeJsonParse(json: string): any {
  try {
    return JSON.parse(json)
  } catch {
    try {
      return JSON.parse(repairJson(json))
    } catch {
      // Last resort: try to extract a JSON object from the string
      const match = json.match(/\{[\s\S]*\}/)
      if (match) {
        try {
          return JSON.parse(repairJson(match[0]))
        } catch {}
      }
      throw new Error(`Invalid JSON: ${json.slice(0, 100)}`)
    }
  }
}
