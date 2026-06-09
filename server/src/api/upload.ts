import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'

const uploadsDir = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// Hash map: persistent JSON mapping sha256 -> filename (basename only)
const HASH_MAP_PATH = path.join(uploadsDir, '.hash-map.json')

function loadHashMap(): Record<string, string> {
  try {
    if (fs.existsSync(HASH_MAP_PATH)) {
      return JSON.parse(fs.readFileSync(HASH_MAP_PATH, 'utf-8'))
    }
  } catch { /* ignore corrupt file, rebuild */ }
  return {}
}

function saveHashMap(map: Record<string, string>) {
  fs.writeFileSync(HASH_MAP_PATH, JSON.stringify(map, null, 2), 'utf-8')
}

function computeHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function attachmentMatchesFilename(attachment: any, filename: string) {
  if (!attachment) return false
  const url = typeof attachment.url === 'string' ? attachment.url : ''
  const name = typeof attachment.name === 'string' ? attachment.name : ''
  const urlBasename = url ? path.basename(url) : ''
  return urlBasename === filename || url.includes(filename) || name === filename
}

// Rebuild hash map from disk on startup (catches manual additions)
function rebuildHashMap(): Record<string, string> {
  const map: Record<string, string> = {}
  try {
    const entries = fs.readdirSync(uploadsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() || entry.name === '.hash-map.json') continue
      const fullPath = path.join(uploadsDir, entry.name)
      const buf = fs.readFileSync(fullPath)
      map[computeHash(buf)] = entry.name
    }
  } catch { /* best-effort */ }
  saveHashMap(map)
  return map
}

// Rebuild if hash map missing or empty (first run / corruption)
let hashMap = loadHashMap()
if (Object.keys(hashMap).length === 0) {
  hashMap = rebuildHashMap()
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${uuidv4()}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
})

const router = Router()

function sanitizeFileStem(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'browser-tab'
}

function buildBrowserTabAttachment(params: {
  title?: string
  url: string
  text?: string
  selection?: string
}) {
  const { title, url, text, selection } = params
  const safeTitle = title?.trim() || 'Browser Tab'
  const lines = [
    `# ${safeTitle}`,
    '',
    `URL: ${url}`,
    `Captured At: ${new Date().toISOString()}`,
  ]

  if (selection?.trim()) {
    lines.push('', '## Selected Text', '', selection.trim())
  }

  if (text?.trim()) {
    lines.push('', '## Page Content', '', text.trim())
  }

  return `${lines.join('\n')}\n`
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.md': 'text/markdown',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.html': 'text/html',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.xml': 'text/xml',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
  }
  return mimeMap[ext] || 'application/octet-stream'
}

// POST /api/upload — upload files with dedup by SHA-256 hash
router.post('/', upload.array('files', 10), (req, res) => {
  const files = req.files as Express.Multer.File[]
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' })
  }

  const attachments = files.map(file => {
    // Compute hash of the saved file
    const buf = fs.readFileSync(file.path)
    const hash = computeHash(buf)

    // Check for duplicate
    const existing = hashMap[hash]
    if (existing) {
      // Remove the newly saved duplicate file, use the existing one
      try { fs.unlinkSync(file.path) } catch { /* ignore */ }
      return {
        id: uuidv4(),
        type: file.mimetype.startsWith('image/') ? 'image' : 'file',
        url: `/uploads/${existing}`,
        name: file.originalname,
        mimeType: file.mimetype,
        deduped: true,
      }
    }

    // New unique file — register in hash map
    const filename = path.basename(file.path)
    hashMap[hash] = filename
    saveHashMap(hashMap)

    return {
      id: uuidv4(),
      type: file.mimetype.startsWith('image/') ? 'image' : 'file',
      url: `/uploads/${filename}`,
      name: file.originalname,
      mimeType: file.mimetype,
    }
  })

  res.json({ attachments })
})

// POST /api/upload/edit — save an edited image as a new upload (each edit = new file)
router.post('/edit', upload.single('file'), (req, res) => {
  const file = req.file as Express.Multer.File
  if (!file) {
    return res.status(400).json({ error: 'No file provided' })
  }

  // Edited images always get saved as a new file (no dedup — edits are intentional changes)
  const buf = fs.readFileSync(file.path)
  const filename = path.basename(file.path)

  // Still register in hash map in case same edit is re-uploaded
  const hash = computeHash(buf)
  hashMap[hash] = filename
  saveHashMap(hashMap)

  const originalName = req.body.originalName || file.originalname
  const editSuffix = req.body.editSuffix || ''

  const displayName = editSuffix
    ? originalName.replace(/\.[^.]+$/, '') + `_${editSuffix}` + path.extname(originalName)
    : originalName

  res.json({
    attachment: {
      id: uuidv4(),
      type: 'image',
      url: `/uploads/${filename}`,
      name: displayName,
      mimeType: file.mimetype,
    },
  })
})

router.post('/browser-tab', (req, res) => {
  const { title, url, text, selection } = req.body || {}

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' })
  }

  const content = buildBrowserTabAttachment({
    title: typeof title === 'string' ? title : undefined,
    url,
    text: typeof text === 'string' ? text : undefined,
    selection: typeof selection === 'string' ? selection : undefined,
  })

  const baseName = sanitizeFileStem(typeof title === 'string' ? title : 'browser-tab')
  const filename = `${uuidv4()}-${baseName}.md`
  const filePath = path.join(uploadsDir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')

  const attachment = {
    id: uuidv4(),
    type: 'file',
    url: `/uploads/${filename}`,
    name: `${typeof title === 'string' && title.trim() ? title.trim() : 'Browser Tab'}.md`,
    mimeType: 'text/markdown',
    sourceUrl: url,
  }

  res.json({ attachments: [attachment] })
})

// GET /api/upload/list — list all uploaded files
router.get('/list', (_req, res) => {
  const files: { name: string; path: string; size: number; mtime: string; type: string; ext: string; hash?: string }[] = []

  try {
    const entries = fs.readdirSync(uploadsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() || entry.name === '.hash-map.json') continue
      const fullPath = path.join(uploadsDir, entry.name)
      const stat = fs.statSync(fullPath)
      const mime = getMimeType(entry.name)

      files.push({
        name: entry.name,
        path: `/uploads/${entry.name}`,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        type: mime,
        ext: path.extname(entry.name).toLowerCase(),
      })
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list uploads' })
  }

  files.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
  res.json({ files })
})

// DELETE /api/upload/:filename — delete an uploaded file and clean stored references
router.delete('/:filename', async (req, res) => {
  const decodedFilename = path.basename(decodeURIComponent(req.params.filename))
  if (!decodedFilename || decodedFilename === '.hash-map.json') {
    return res.status(400).json({ error: 'Invalid filename' })
  }

  const filePath = path.join(uploadsDir, decodedFilename)
  if (!filePath.startsWith(`${uploadsDir}${path.sep}`)) {
    return res.status(400).json({ error: 'Invalid filename' })
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' })
  }

  try {
    fs.unlinkSync(filePath)

    for (const [hash, filename] of Object.entries(hashMap)) {
      if (filename === decodedFilename) {
        delete hashMap[hash]
      }
    }
    saveHashMap(hashMap)

    const db = await getDb()
    const rows = await db.all(
      `SELECT id, attachments FROM messages WHERE attachments IS NOT NULL AND attachments != ''`
    )
    let updatedMessages = 0

    for (const row of rows) {
      let attachments: any[]
      try {
        attachments = JSON.parse(row.attachments)
      } catch {
        continue
      }
      if (!Array.isArray(attachments)) continue

      const nextAttachments = attachments.filter((a: any) => !attachmentMatchesFilename(a, decodedFilename))
      if (nextAttachments.length !== attachments.length) {
        await db.run(
          'UPDATE messages SET attachments = ? WHERE id = ?',
          nextAttachments.length > 0 ? JSON.stringify(nextAttachments) : null,
          row.id,
        )
        updatedMessages += 1
      }
    }

    await db.run(
      `DELETE FROM project_files
       WHERE file_url LIKE ? OR name = ?`,
      `%/${decodedFilename}`,
      decodedFilename,
    )

    res.json({
      success: true,
      filename: decodedFilename,
      updatedMessages,
    })
  } catch (err: any) {
    console.error('[upload] Failed to delete upload:', err)
    res.status(500).json({ error: err.message || 'Failed to delete upload' })
  }
})

// GET /api/upload/:filename/sessions — find all chats that reference this file
router.get('/:filename/sessions', async (req, res) => {
  const { filename } = req.params
  // URL-decode the filename (the URL has /uploads/ prefix stripped by the route)
  const decodedFilename = decodeURIComponent(filename)

  try {
    const db = await getDb()

    // Find all messages with attachments referencing this file
    // attachment.url is like /uploads/uuid.ext — match the basename
    const rows = await db.all(
      `SELECT session_id, attachments FROM messages WHERE attachments IS NOT NULL AND attachments != ''`
    )

    const sessionMap = new Map<string, { id: string; title: string; updatedAt: number }>()

    for (const row of rows) {
      let attachments: any[]
      try {
        attachments = JSON.parse(row.attachments)
      } catch {
        continue
      }
      if (!Array.isArray(attachments)) continue

      const match = attachments.some((a: any) => {
        if (!a || !a.url) return false
        // Match if the URL ends with the filename, or if the URL path contains the filename
        return a.url.includes(decodedFilename) || a.name === decodedFilename
      })

      if (match && !sessionMap.has(row.session_id)) {
        // Fetch session title
        const session = await db.get(
          'SELECT id, title, updated_at FROM sessions WHERE id = ?',
          row.session_id
        )
        if (session) {
          sessionMap.set(row.session_id, {
            id: session.id,
            title: session.title,
            updatedAt: session.updated_at,
          })
        }
      }
    }

    const sessions = Array.from(sessionMap.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)

    res.json({ sessions })
  } catch (err: any) {
    console.error('[upload] Failed to find sessions for file:', err)
    res.status(500).json({ error: err.message || 'Failed to find sessions' })
  }
})

export default router
