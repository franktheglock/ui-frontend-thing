import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'

const uploadsDir = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
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

router.post('/', upload.array('files', 10), (req, res) => {
  const files = req.files as Express.Multer.File[]
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' })
  }

  const attachments = files.map(file => ({
    id: uuidv4(),
    type: file.mimetype.startsWith('image/') ? 'image' : 'file',
    url: `/uploads/${file.filename}`,
    name: file.originalname,
    mimeType: file.mimetype,
  }))

  res.json({ attachments })
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

export default router
