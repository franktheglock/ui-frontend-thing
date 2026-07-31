import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs-extra'
import path from 'path'
import tar from 'tar'
import { getDb } from '../db'
import { isInsideDir, resolveWithin } from '../utils/path-safety'

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

const SKILLS_DIR = path.resolve(process.env.SKILLS_DIR || findSkillsDir())
const SKILLS_API = 'https://skills.sh/api/v1'
const SKILLS_API_KEY = process.env.SKILLS_API_KEY

function skillsHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (SKILLS_API_KEY) {
    headers['Authorization'] = `Bearer ${SKILLS_API_KEY}`
  }
  return headers
}

/**
 * Write skill files from a remote response, rejecting path traversal (zip/tar-slip style).
 */
async function writeSkillFiles(
  installDir: string,
  files: { path: string; contents: string }[],
): Promise<number> {
  await fs.ensureDir(installDir)
  let written = 0
  for (const file of files) {
    if (!file.path || typeof file.path !== 'string') {
      throw new Error('Skill file entry missing path')
    }
    // Normalize and reject absolute / traversal paths
    const normalized = file.path.replace(/\\/g, '/')
    if (
      path.isAbsolute(file.path) ||
      normalized.startsWith('/') ||
      normalized.includes('..') ||
      normalized.includes('\0')
    ) {
      throw new Error(`Refusing skill file with unsafe path: ${file.path}`)
    }
    const filePath = resolveWithin(installDir, normalized)
    if (!filePath) {
      throw new Error(`Refusing skill file outside install dir: ${file.path}`)
    }
    await fs.ensureDir(path.dirname(filePath))
    await fs.writeFile(filePath, file.contents ?? '')
    written++
  }
  return written
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

      const safeSource = detail.source.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)
      const safeSlug = detail.slug.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)
      const installDir = path.join(SKILLS_DIR, safeSource, safeSlug)
      if (!isInsideDir(SKILLS_DIR, installDir)) {
        throw new Error('Invalid skill install path')
      }
      const fileCount = await writeSkillFiles(installDir, detail.files)

      const db = await getDb()
      const now = Date.now()
      const id = uuidv4()

      const installPath = path.relative(SKILLS_DIR, installDir)
      await db.run(
        'INSERT INTO skills (id, name, version, source, manifest, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, skillName, '1.0.0', skillId, JSON.stringify({
          name: skillName, version: '1.0.0', description: '', source: skillId, installPath,
        }), now, now
      )

      return res.json({ id, name: skillName, source: skillId, files: fileCount, installPath })
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

        const safeSource = detail.source.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)
        const safeSlug = detail.slug.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)
        const installDir = path.join(SKILLS_DIR, safeSource, safeSlug)
        if (!isInsideDir(SKILLS_DIR, installDir)) {
          throw new Error('Invalid skill install path')
        }
        const fileCount = await writeSkillFiles(installDir, detail.files)

        const db = await getDb()
        const now = Date.now()
        const id = uuidv4()

        const installPath = path.relative(SKILLS_DIR, installDir)
        await db.run(
          'INSERT INTO skills (id, name, version, source, manifest, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id, skillName, '1.0.0', parsedSkillId, JSON.stringify({
            name: skillName, version: '1.0.0', description: '', source: parsedSkillId, installPath,
          }), now, now
        )

        return res.json({ id, name: skillName, source: parsedSkillId, files: fileCount, installPath })
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

      // Extract with tar-slip protection
      const extractDir = path.join(SKILLS_DIR, uuidv4())
      if (!isInsideDir(SKILLS_DIR, extractDir)) {
        throw new Error('Invalid extract path')
      }
      await fs.ensureDir(extractDir)
      const extractRoot = path.resolve(extractDir)
      await tar.extract({
        file: tempPath,
        cwd: extractDir,
        strip: 1,
        filter: (entryPath: string) => {
          // Reject absolute paths and path traversal (classic tar-slip)
          if (!entryPath || entryPath.includes('\0')) return false
          if (path.isAbsolute(entryPath) || entryPath.startsWith('/') || entryPath.startsWith('~')) {
            console.warn('[skills] Rejected tar entry (absolute):', entryPath)
            return false
          }
          const normalized = entryPath.replace(/\\/g, '/')
          if (normalized.split('/').some((seg) => seg === '..')) {
            console.warn('[skills] Rejected tar entry (traversal):', entryPath)
            return false
          }
          const resolved = path.resolve(extractRoot, entryPath)
          if (!isInsideDir(extractRoot, resolved)) {
            console.warn('[skills] Rejected tar entry (escape):', entryPath)
            return false
          }
          return true
        },
      })
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

      const installPath = path.relative(SKILLS_DIR, extractDir)
      await db.run(
        'INSERT INTO skills (id, name, version, source, manifest, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, skillName, '1.0.0', downloadUrl, JSON.stringify({
          name: skillName, version: '1.0.0', description: '', source: downloadUrl, installPath,
        }), now, now
      )

      return res.json({ id, name: skillName, source: downloadUrl, path: extractDir, installPath })
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// ---------------------------------------------------------------------------
// Local skill management (list / delete)
// ---------------------------------------------------------------------------

/**
 * Resolve a filesystem directory to delete for a skill row.
 * Never treats skill.source (often a URL or skills.sh id) as a path.
 */
async function resolveSkillInstallDir(skill: {
  id: string
  name?: string
  source?: string
  manifest?: string
}): Promise<string | null> {
  let manifest: any = {}
  try {
    manifest = skill.manifest ? JSON.parse(skill.manifest) : {}
  } catch {
    manifest = {}
  }

  const candidates: string[] = []

  if (typeof manifest.installPath === 'string' && manifest.installPath) {
    candidates.push(path.join(SKILLS_DIR, manifest.installPath))
  }

  // Directory named after the DB id (filesystem-scanned skills use entry as id)
  if (skill.id && !skill.id.includes('/') && !skill.id.includes('://')) {
    candidates.push(path.join(SKILLS_DIR, skill.id))
  }

  // Nested installs: source like "owner/repo/slug" → owner_repo_slug is wrong;
  // prefer installPath. Also try source with / → _
  if (skill.source && !skill.source.includes('://') && !skill.source.startsWith('http')) {
    candidates.push(path.join(SKILLS_DIR, skill.source.replace(/\//g, '_')))
    candidates.push(path.join(SKILLS_DIR, skill.source))
  }

  // Search by skill name in SKILL.md under SKILLS_DIR (one and two levels)
  if (skill.name) {
    try {
      const top = await fs.readdir(SKILLS_DIR)
      for (const entry of top) {
        const level1 = path.join(SKILLS_DIR, entry)
        const md1 = path.join(level1, 'SKILL.md')
        if (await fs.pathExists(md1)) {
          const content = await fs.readFile(md1, 'utf-8')
          const nameMatch = content.match(/^---[\s\S]*?name:\s*(.+?)\s*$/m)
          if (nameMatch && nameMatch[1].trim() === skill.name) {
            candidates.push(level1)
          }
        }
        try {
          const nested = await fs.readdir(level1)
          for (const child of nested) {
            const level2 = path.join(level1, child)
            const md2 = path.join(level2, 'SKILL.md')
            if (await fs.pathExists(md2)) {
              const content = await fs.readFile(md2, 'utf-8')
              const nameMatch = content.match(/^---[\s\S]*?name:\s*(.+?)\s*$/m)
              if (nameMatch && nameMatch[1].trim() === skill.name) {
                candidates.push(level2)
              }
            }
          }
        } catch {
          // not a directory
        }
      }
    } catch {
      // skills dir missing
    }
  }

  for (const candidate of candidates) {
    if (!isInsideDir(SKILLS_DIR, candidate)) continue
    if (await fs.pathExists(candidate)) {
      return candidate
    }
  }
  return null
}

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
            manifest: { name: skillName, description: skillDesc, version: '1.0.0', installPath: entry },
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
    const installDir = await resolveSkillInstallDir(skill)
    if (installDir && isInsideDir(SKILLS_DIR, installDir)) {
      await fs.remove(installDir)
    }
  } catch (err: any) {
    console.error('[skills] Failed to remove install dir:', err.message)
  }

  await db.run('DELETE FROM skills WHERE id = ?', req.params.id)
  res.json({ success: true })
})
// ---------------------------------------------------------------------------
// Read skill content for active skill injection
// ---------------------------------------------------------------------------

router.get('/content/:name', async (req, res) => {
  const skillName = req.params.name
  if (!skillName || skillName.includes('..') || skillName.includes('\0')) {
    return res.status(400).json({ error: 'Invalid skill name' })
  }
  const normalizedName = skillName.replace(/\//g, '_').replace(/[^a-zA-Z0-9._-]/g, '_')

  // Try direct path first
  let mdPath = path.join(SKILLS_DIR, normalizedName, 'SKILL.md')
  if (!isInsideDir(SKILLS_DIR, mdPath)) {
    return res.status(400).json({ error: 'Invalid skill name' })
  }

  if (!await fs.pathExists(mdPath)) {
    // Search for skill by name in subdirectories (one level)
    const entries = await fs.readdir(SKILLS_DIR).catch(() => [] as string[])
    for (const entry of entries) {
      if (entry.includes('..') || entry.includes('\0')) continue
      const candidatePath = path.join(SKILLS_DIR, entry, 'SKILL.md')
      if (!isInsideDir(SKILLS_DIR, candidatePath)) continue
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

  if (!await fs.pathExists(mdPath) || !isInsideDir(SKILLS_DIR, mdPath)) {
    return res.status(404).json({ error: 'Skill not found' })
  }

  const content = await fs.readFile(mdPath, 'utf-8')
  res.json({ content })
})

export default router
