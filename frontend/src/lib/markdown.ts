/**
 * Escape currency-style `$` so remark-math does not treat `$0.01 ... $0.03` as
 * a single italic math run (which shows as spaced/italic gibberish).
 * Leaves `$$...$$` display math and `$x$`-style alpha math alone.
 * Skips fenced and inline code spans.
 */
export function protectCurrencyDollars(text: string): string {
  if (!text || !text.includes('$')) return text

  // Split on fenced blocks and inline code so we don't touch code samples
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g)

  return parts
    .map((part) => {
      if (part.startsWith('```') || (part.startsWith('`') && part.endsWith('`'))) {
        return part
      }
      // $ not already escaped, not part of $$, followed by a digit → currency
      return part.replace(/(^|[^\\])\$(?!\$)(?=\d)/g, '$1\\$')
    })
    .join('')
}
