import { BaseTool } from './base'
import fs from 'fs-extra'
import path from 'path'

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

async function findSkills(): Promise<Array<{ name: string; path: string; content: string }>> {
  const skills: Array<{ name: string; path: string; content: string }> = []

  if (!await fs.pathExists(SKILLS_DIR)) {
    return skills
  }

  const entries = await fs.readdir(SKILLS_DIR)
  for (const entry of entries) {
    const skillPath = path.join(SKILLS_DIR, entry)
    const stat = await fs.stat(skillPath)
    if (!stat.isDirectory()) continue

    const mdPath = path.join(skillPath, 'SKILL.md')
    if (await fs.pathExists(mdPath)) {
      const content = await fs.readFile(mdPath, 'utf-8')
      const nameMatch = content.match(/^---[\s\S]*?name:\s*(.+?)\s*$/m)
      skills.push({
        name: nameMatch ? nameMatch[1].trim() : entry,
        path: entry,
        content,
      })
    }
  }

  return skills
}

export class ListSkillsTool extends BaseTool {
  id = 'list_skills'
  name = 'list_skills'
  description = 'List all installed skills with their names, paths, and brief descriptions. Use this to discover what skills are available before reading one with `read_skill`.'
  parameters = {
    type: 'object',
    properties: {},
    required: [],
  }

  async execute(_args: Record<string, unknown>): Promise<string> {
    const skills = await findSkills()

    if (skills.length === 0) {
      return 'No skills installed.'
    }

    return skills.map(s => {
      const descMatch = s.content.match(/^---[\s\S]*?description:\s*(.+?)\s*$/m)
      const desc = descMatch ? descMatch[1].trim() : 'No description'
      return `**${s.name}** (path: \`${s.path}\`)\n${desc}`
    }).join('\n\n')
  }
}

export class ReadSkillTool extends BaseTool {
  id = 'read_skill'
  name = 'read_skill'
  description = 'Read the full contents of a specific skill by its path or name. Use this after search_skills to get the complete skill content.'
  parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The skill path or name (e.g. "frontend-design" or "anthropics/skills/frontend-design")',
      },
    },
    required: ['path'],
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const skillPath = args.path as string
    const normalizedPath = skillPath.replace(/\//g, '_')
    const mdPath = path.join(SKILLS_DIR, normalizedPath, 'SKILL.md')

    if (!await fs.pathExists(mdPath)) {
      // Try finding by name
      const skills = await findSkills()
      const match = skills.find(s =>
        s.name.toLowerCase() === skillPath.toLowerCase() ||
        s.path.toLowerCase() === skillPath.toLowerCase()
      )
      if (match) {
        return match.content
      }
      return `Skill not found: ${skillPath}`
    }

    return await fs.readFile(mdPath, 'utf-8')
  }
}

export class MakeSkillTool extends BaseTool {
  id = 'make_skill'
  name = 'make_skill'
  description = 'Create a new skill or edit an existing one by writing the full SKILL.md file. The skill will be saved in the skills directory and immediately available. To edit an existing skill, use the exact same name. Use kebab-case for the skill name.'
  parameters = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Skill name in kebab-case (e.g. "react-hooks", "api-design")',
      },
      content: {
        type: 'string',
        description: 'The full SKILL.md content including YAML frontmatter with name, description, and usage instructions',
      },
    },
    required: ['name', 'content'],
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = args.name as string
    const content = args.content as string

    if (!name || !content) {
      return 'Error: name and content are required'
    }

    const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    const skillDir = path.join(SKILLS_DIR, safeName)
    const mdPath = path.join(skillDir, 'SKILL.md')

    await fs.ensureDir(skillDir)
    await fs.writeFile(mdPath, content)

    return `Successfully created skill "${safeName}" at ${mdPath}`
  }
}
