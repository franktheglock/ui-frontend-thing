import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs-extra'
import path from 'path'
import tar from 'tar'
import { getDb } from '../db'

const router = Router()
function findSkillsDir() {
  const paths = [
    path.join(process.cwd(), 'skills'),
    path.join(process.cwd(), '..', 'skills')
  ]
  for (const p of paths) {
    if (fs.existsSync(p)) return p
  }
  return paths[0]
}

const SKILLS_DIR = process.env.SKILLS_DIR || findSkillsDir()
const SKILLS_API = 'https://skills.sh/api/v1'
const SKILLS_API_KEY = process.env.SKILLS_API_KEY

function skillsHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (SKILLS_API_KEY) {
    headers['Authorization'] = `Bearer ${SKILLS_API_KEY}`
  }
  return headers
}

interface SkillsShSkill {
  id: string
  slug: string
  name: string
  source: string
  installs: number
  sourceType: string
  installUrl: string | null
  url: string
  isDuplicate?: boolean
}

interface SkillsShDetail {
  id: string
  source: string
  slug: string
  installs: number
  hash: string | null
  files: { path: string; contents: string }[] | null
}

// ---------------------------------------------------------------------------
// Browse / search skills.sh catalog
// ---------------------------------------------------------------------------

router.get('/browse', async (req, res) => {
  const { q, view = 'trending', page = '0', per_page = '50' } = req.query

  try {
    let url: string
    if (q && String(q).trim()) {
      url = `${SKILLS_API}/skills/search?q=${encodeURIComponent(String(q))}&limit=${per_page}`
    } else {
      url = `${SKILLS_API}/skills?view=${view}&page=${page}&per_page=${per_page}`
    }

    console.log('[skills.sh] fetching:', url)
    const response = await fetch(url, { headers: skillsHeaders() })
    console.log('[skills.sh] response status:', response.status)
    
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error('[skills.sh] error body:', text)
      throw new Error(`skills.sh API error: ${response.status}`)
    }
    
    const data = await response.json()
    res.json(data)
  } catch (error: any) {
    console.error('[skills.sh] browse error:', error)
    res.status(500).json({ error: error.message })
  }
})

router.get('/curated', async (_req, res) => {
  try {
    const url = `${SKILLS_API}/skills/curated`
    console.log('[skills.sh] fetching curated:', url)
    const response = await fetch(url, { headers: skillsHeaders() })
    console.log('[skills.sh] curated response status:', response.status)
    
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error('[skills.sh] curated error body:', text)
      throw new Error(`skills.sh API error: ${response.status}`)
    }
    
    const data = await response.json()
    res.json(data)
  } catch (error: any) {
    console.error('[skills.sh] curated error:', error)
    res.status(500).json({ error: error.message })
  }
})

router.get('/detail/:source/:slug', async (req, res) => {
  const { source, slug } = req.params
  const skillId = `${source}/${slug}`

  try {
    const response = await fetch(`${SKILLS_API}/skills/${skillId}`, { headers: skillsHeaders() })
    if (!response.ok) throw new Error(`skills.sh API error: ${response.status}`)
    const data: SkillsShDetail = await response.json() as SkillsShDetail
    res.json(data)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.get('/audit/:source/:slug', async (req, res) => {
  const { source, slug } = req.params
  const skillId = `${source}/${slug}`

  try {
    const response = await fetch(`${SKILLS_API}/skills/audit/${skillId}`, { headers: skillsHeaders() })
    if (!response.ok) throw new Error(`skills.sh API error: ${response.status}`)
    const data = await response.json()
    res.json(data)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// ---------------------------------------------------------------------------
// Install a skill from skills.sh
// ---------------------------------------------------------------------------

router.post('/install', async (req, res) => {
  const { skillId, source } = req.body

  if (!skillId && !source) {
    return res.status(400).json({ error: 'skillId or source required' })
  }

  try {
    // -------------------------------------------------------------------------
    // Case 1: Install from skills.sh catalog by skillId
    // -------------------------------------------------------------------------
    if (skillId) {
      const response = await fetch(`${SKILLS_API}/skills/${skillId}`, { headers: skillsHeaders() })
      if (!response.ok) throw new Error(`Failed to fetch skill: ${response.status}`)
      const detail: SkillsShDetail = await response.json() as SkillsShDetail

      if (!detail.files || detail.files.length === 0) {
        throw new Error('Skill has no files')
      }

      const skillMd = detail.files.find(f => f.path === 'SKILL.md')
      const nameMatch = skillMd?.contents.match(/^---[\s\S]*?name:\s*(.+?)\s*$/m)
      const skillName = nameMatch ? nameMatch[1].trim() : detail.slug

      const installDir = path.join(SKILLS_DIR, detail.source.replace(/\//g, '_'), detail.slug)
      await fs.ensureDir(installDir)

      for (const file of detail.files) {
        const filePath = path.join(installDir, file.path)
        await fs.ensureDir(path.dirname(filePath))
        await fs.writeFile(filePath, file.contents)
      }

      const db = await getDb()
      const now = Date.now()
      const id = uuidv4()

      await db.run(
        'INSERT INTO skills (id, name, version, source, manifest, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, skillName, '1.0.0', skillId, JSON.stringify({ name: skillName, version: '1.0.0', description: '', source: skillId }), now, now
      )

      return res.json({ id, name: skillName, source: skillId, files: detail.files.length })
    }

    // -------------------------------------------------------------------------
    // Case 2: Install from a skills.sh page URL (e.g. https://skills.sh/anthropics/skills/frontend-design)
    // -------------------------------------------------------------------------
    if (source) {
      let sourceUrl = source as string
      let skillName = ''

      // Detect skills.sh page URL and extract skillId
      const skillsShMatch = sourceUrl.match(/^https?:\/\/skills\.sh\/(.+)$/)
      if (skillsShMatch) {
        const parsedSkillId = skillsShMatch[1]
        // Route through skills.sh API to get files
        const response = await fetch(`${SKILLS_API}/skills/${parsedSkillId}`, { headers: skillsHeaders() })
        if (!response.ok) throw new Error(`Failed to fetch skill from skills.sh: ${response.status}`)
        const detail: SkillsShDetail = await response.json() as SkillsShDetail

        if (!detail.files || detail.files.length === 0) {
          throw new Error('Skill has no files')
        }

        const skillMd = detail.files.find(f => f.path === 'SKILL.md')
        const nameMatch = skillMd?.contents.match(/^---[\s\S]*?name:\s*(.+?)\s*$/m)
        skillName = nameMatch ? nameMatch[1].trim() : detail.slug

        const installDir = path.join(SKILLS_DIR, detail.source.replace(/\//g, '_'), detail.slug)
        await fs.ensureDir(installDir)

        for (const file of detail.files) {
          const filePath = path.join(installDir, file.path)
          await fs.ensureDir(path.dirname(filePath))
          await fs.writeFile(filePath, file.contents)
        }

        const db = await getDb()
        const now = Date.now()
        const id = uuidv4()

        await db.run(
          'INSERT INTO skills (id, name, version, source, manifest, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id, skillName, '1.0.0', parsedSkillId, JSON.stringify({ name: skillName, version: '1.0.0', description: '', source: parsedSkillId }), now, now
        )

        return res.json({ id, name: skillName, source: parsedSkillId, files: detail.files.length })
      }

      // -----------------------------------------------------------------------
      // Case 3: Install from a raw URL (tarball, GitHub repo, etc.)
      // -----------------------------------------------------------------------
      let downloadUrl = sourceUrl

      // Convert GitHub repo URL to tarball URL
      if (downloadUrl.includes('github.com') && !downloadUrl.endsWith('.tar.gz') && !downloadUrl.endsWith('.tgz')) {
        const match = downloadUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/)
        if (match) {
          const [, owner, repo] = match
          const cleanRepo = repo.replace(/\.git$/, '')
          downloadUrl = `https://github.com/${owner}/${cleanRepo}/archive/refs/heads/main.tar.gz`
          skillName = cleanRepo
        }
      }

      if (!downloadUrl.startsWith('http')) {
        return res.status(400).json({ error: 'Invalid source URL' })
      }

      // Download tarball
      const response = await fetch(downloadUrl)
      if (!response.ok) throw new Error(`Failed to download: ${response.status}`)

      const buffer = await response.arrayBuffer()
      const tempPath = path.join(process.cwd(), 'tmp', `${uuidv4()}.tar.gz`)
      await fs.ensureDir(path.dirname(tempPath))
      await fs.writeFile(tempPath, Buffer.from(buffer))

      // Extract
      const extractDir = path.join(SKILLS_DIR, uuidv4())
      await fs.ensureDir(extractDir)
      await tar.extract({ file: tempPath, cwd: extractDir, strip: 1 })
      await fs.remove(tempPath)

      // Find SKILL.md and extract name
      const skillMdPath = path.join(extractDir, 'SKILL.md')
      if (await fs.pathExists(skillMdPath)) {
        const skillMd = await fs.readFile(skillMdPath, 'utf-8')
        const nameMatch = skillMd.match(/^---[\s\S]*?name:\s*(.+?)\s*$/m)
        if (nameMatch) skillName = nameMatch[1].trim()
      }

      if (!skillName) {
        skillName = path.basename(extractDir)
      }

      // Save to DB
      const db = await getDb()
      const now = Date.now()
      const id = uuidv4()

      await db.run(
        'INSERT INTO skills (id, name, version, source, manifest, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, skillName, '1.0.0', downloadUrl, JSON.stringify({ name: skillName, version: '1.0.0', description: '', source: downloadUrl }), now, now
      )

      return res.json({ id, name: skillName, source: downloadUrl, path: extractDir })
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// ---------------------------------------------------------------------------
// Local skill management (list / delete)
// ---------------------------------------------------------------------------

router.get('/local', async (_req, res) => {
  try {
    const db = await getDb()
    const dbSkills = await db.all('SELECT * FROM skills ORDER BY installed_at DESC')
    const skills = dbSkills.map((s: any) => ({
      ...s,
      manifest: JSON.parse(s.manifest),
    }))

    // Also scan directory for skills not in DB
    const entries = await fs.readdir(SKILLS_DIR).catch(() => [] as string[])
    for (const entry of entries) {
      const skillMdPath = path.join(SKILLS_DIR, entry, 'SKILL.md')
      if (await fs.pathExists(skillMdPath)) {
        const content = await fs.readFile(skillMdPath, 'utf-8')
        const nameMatch = content.match(/^---[\s\S]*?name:\s*(.+?)\s*$/m)
        const descMatch = content.match(/^---[\s\S]*?description:\s*(.+?)\s*$/m)
        const skillName = nameMatch ? nameMatch[1].trim() : entry
        const skillDesc = descMatch ? descMatch[1].trim() : ''

        // Only add if not already in list (check by name or source)
        if (!skills.some((s: any) => s.name === skillName)) {
          skills.push({
            id: entry,
            name: skillName,
            version: '1.0.0',
            source: entry,
            manifest: { name: skillName, description: skillDesc, version: '1.0.0' },
            installed_at: (await fs.stat(skillMdPath)).mtimeMs,
            updated_at: (await fs.stat(skillMdPath)).mtimeMs,
          })
        }
      }
    }

    res.json(skills)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.delete('/:id', async (req, res) => {
  const db = await getDb()
  const skill = await db.get('SELECT * FROM skills WHERE id = ?', req.params.id) as any
  if (!skill) return res.status(404).json({ error: 'Skill not found' })

  try {
    await fs.remove(skill.source)
  } catch {}

  await db.run('DELETE FROM skills WHERE id = ?', req.params.id)
  res.json({ success: true })
})

// ---------------------------------------------------------------------------
// Read skill content for active skill injection
// ---------------------------------------------------------------------------

router.get('/content/:name', async (req, res) => {
  const skillName = req.params.name
  const normalizedName = skillName.replace(/\//g, '_')

  // Try direct path first
  let mdPath = path.join(SKILLS_DIR, normalizedName, 'SKILL.md')

  if (!await fs.pathExists(mdPath)) {
    // Search for skill by name in subdirectories
    const entries = await fs.readdir(SKILLS_DIR).catch(() => [] as string[])
    for (const entry of entries) {
      const candidatePath = path.join(SKILLS_DIR, entry, 'SKILL.md')
      if (await fs.pathExists(candidatePath)) {
        const content = await fs.readFile(candidatePath, 'utf-8')
        const nameMatch = content.match(/^---[\s\S]*?name:\s*(.+?)\s*$/m)
        if (nameMatch && nameMatch[1].trim().toLowerCase() === skillName.toLowerCase()) {
          mdPath = candidatePath
          break
        }
      }
    }
  }

  if (!await fs.pathExists(mdPath)) {
    return res.status(404).json({ error: 'Skill not found' })
  }

  const content = await fs.readFile(mdPath, 'utf-8')
  res.json({ content })
})

export default router
