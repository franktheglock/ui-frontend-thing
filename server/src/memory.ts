import fs from 'fs'
import path from 'path'

const DEFAULT_MEMORY = `# User Memory

These are durable facts and preferences the user has asked the assistant to remember, or that are clearly stable and useful for future conversations.

## Profile

- _No memories saved yet._

## Preferences

- _No memories saved yet._

## Interests and hobbies

- _No memories saved yet._

## Current life context

- _No memories saved yet._
`

function getProjectRoot() {
  const cwd = process.cwd()
  if (path.basename(cwd).toLowerCase() === 'server') {
    return path.dirname(cwd)
  }
  return cwd
}

export function getMemoryFilePath() {
  return process.env.MEMORY_FILE
    ? path.resolve(process.env.MEMORY_FILE)
    : path.join(getProjectRoot(), 'data', 'memory.md')
}

export function readMemory() {
  const filePath = getMemoryFilePath()
  if (!fs.existsSync(filePath)) {
    return DEFAULT_MEMORY
  }

  const content = fs.readFileSync(filePath, 'utf-8').trim()
  return content || DEFAULT_MEMORY
}

export function ensureMemoryFile() {
  const filePath = getMemoryFilePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, DEFAULT_MEMORY, 'utf-8')
  }
  return filePath
}

export function writeMemory(content: string) {
  const filePath = ensureMemoryFile()
  const trimmed = content.trim()
  fs.writeFileSync(filePath, `${trimmed || DEFAULT_MEMORY}\n`, 'utf-8')
  return filePath
}

export function appendMemory(category: string, memory: string) {
  ensureMemoryFile()
  const normalizedCategory = category.trim() || 'General'
  const normalizedMemory = memory.trim().replace(/\s+/g, ' ')
  if (!normalizedMemory) {
    throw new Error('Memory text is required')
  }

  const current = readMemory()
  const heading = `## ${normalizedCategory}`
  const line = `- ${normalizedMemory}`

  if (current.toLowerCase().includes(line.toLowerCase())) {
    return { filePath: getMemoryFilePath(), content: current, changed: false }
  }

  let next: string
  const headingRegex = new RegExp(`(^##\\s+${escapeRegExp(normalizedCategory)}\\s*$)`, 'im')
  const match = current.match(headingRegex)

  if (match?.index !== undefined) {
    const insertAt = findEndOfSection(current, match.index + match[0].length)
    const section = current.slice(match.index, insertAt)
    const cleanedSection = section.replace(/\n- _No memories saved yet\._/i, '')
    next = current.slice(0, match.index) + cleanedSection.trimEnd() + `\n${line}\n` + current.slice(insertAt)
  } else {
    next = `${current.trimEnd()}\n\n${heading}\n\n${line}\n`
  }

  const filePath = writeMemory(next)
  return { filePath, content: readMemory(), changed: true }
}

export function replaceMemory(content: string) {
  const filePath = writeMemory(content)
  return { filePath, content: readMemory(), changed: true }
}

function findEndOfSection(markdown: string, start: number) {
  const rest = markdown.slice(start)
  const nextHeading = rest.search(/^##\s+/m)
  return nextHeading === -1 ? markdown.length : start + nextHeading
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
