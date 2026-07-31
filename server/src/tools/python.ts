import { BaseTool } from './base'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { resolveWithin } from '../utils/path-safety'

const execAsync = promisify(exec)

const VENV_DIR = path.join(process.cwd(), '.venv')
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(VENV_DIR, 'Scripts', 'python.exe')
  : path.join(VENV_DIR, 'bin', 'python')

/** Persistent workspace shared with the terminal tool and code_edit. */
const WORKSPACE_DIR = path.join(process.cwd(), 'workspace')
/** Where user-facing plot/files are published for the browser. */
const PUBLIC_OUTPUT_DIR = path.join(process.cwd(), 'uploads', 'python-out')
/** Relative output folder inside the workspace (cwd when scripts run). */
const OUTPUT_REL = 'output'

function ensureVenv(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(VENV_PYTHON)) {
      resolve()
      return
    }
    exec(`python -m venv "${VENV_DIR}"`, (error) => {
      if (error) {
        exec(`python3 -m venv "${VENV_DIR}"`, (error2) => {
          if (error2) reject(new Error(`Python not found (tried 'python' and 'python3'). ${error2.message}`))
          else resolve()
        })
      } else resolve()
    })
  })
}

function ensureDirs() {
  for (const dir of [WORKSPACE_DIR, path.join(WORKSPACE_DIR, OUTPUT_REL), PUBLIC_OUTPUT_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

/** Snapshot basenames → mtimeMs for files directly under dir. */
function snapshotDir(dir: string): Map<string, number> {
  const map = new Map<string, number>()
  if (!fs.existsSync(dir)) return map
  for (const name of fs.readdirSync(dir)) {
    if (name === '.' || name === '..') continue
    try {
      const st = fs.statSync(path.join(dir, name))
      if (st.isFile()) map.set(name, st.mtimeMs)
    } catch {
      // ignore
    }
  }
  return map
}

/**
 * Pick a public filename that does not clobber an existing upload.
 * `plot.png` → `plot.png` or `plot-1785509108070.png` if taken.
 */
function uniquePublicName(preferred: string): string {
  const safe = path.basename(preferred)
  const dest = path.join(PUBLIC_OUTPUT_DIR, safe)
  if (!fs.existsSync(dest)) return safe
  const ext = path.extname(safe)
  const stem = path.basename(safe, ext)
  return `${stem}-${Date.now()}${ext}`
}

export class PythonTool extends BaseTool {
  id = 'python'
  name = 'python'
  description = [
    'Execute Python code on the host (venv only — not a security sandbox).',
    '',
    '## Layout (important)',
    '- Working directory is the persistent `workspace/` folder (same as the terminal tool).',
    '- `code_edit` writes scripts into that workspace; run them with file_path.',
    '- Save plots/files under `./output/` (i.e. workspace/output/).',
    '- After the run, NEW/UPDATED files in `./output/` are published to the web at `/uploads/python-out/<filename>`.',
    '- Prefer unique output filenames (e.g. include a topic or timestamp). If a name already exists in python-out, the tool renames automatically and reports the final URL.',
    '',
    '## Showing images to the user',
    'Use the exact markdown URLs returned by the tool, e.g. `![plot](/uploads/python-out/myplot.png)`.',
    'Do NOT invent paths like `./output/foo.png` in the chat — those are not served to the browser.',
    '',
    'Use matplotlib with the Agg backend. Install packages with the packages parameter.',
  ].join('\n')
  parameters = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Python code to run (optional if file_path is set). cwd is the persistent workspace/.',
      },
      file_path: {
        type: 'string',
        description:
          'Script path relative to the persistent workspace/ (e.g. "analysis.py" from code_edit). Prefer this for multi-step work.',
      },
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'pip packages to install before running (e.g. ["numpy", "matplotlib"])',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default 30, max 1800)',
      },
    },
    required: [],
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const code = args.code as string
    const filePath = args.file_path as string
    const packages = (args.packages as string[]) || []
    const timeoutSec = Math.min(Math.max((args.timeout as number) || 30, 1), 1800) * 1000

    if (!code && !filePath) return 'Error: Provide either `code` or `file_path`'

    try {
      await ensureVenv()
      ensureDirs()

      const workspaceOutput = path.join(WORKSPACE_DIR, OUTPUT_REL)

      if (packages.length > 0) {
        const safePackages = packages.filter((p) => /^[A-Za-z0-9_.\-\[\],=<>!~]+$/.test(p))
        if (safePackages.length !== packages.length) {
          return 'Error: Invalid package name(s). Only alphanumeric characters and common version operators are allowed.'
        }
        await execAsync(
          `"${VENV_PYTHON}" -m pip install ${safePackages.map((p) => `"${p}"`).join(' ')}`,
          { timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
        )
      }

      const before = snapshotDir(workspaceOutput)

      let scriptPath: string
      let cleanupScript: string | null = null

      if (filePath) {
        const sourcePath = resolveWithin(WORKSPACE_DIR, filePath)
        if (!sourcePath) {
          return `Error: Invalid file path (must stay within workspace): ${filePath}`
        }
        if (!fs.existsSync(sourcePath)) {
          return `Error: File not found in workspace: ${filePath}. Use code_edit to create it first.`
        }
        scriptPath = sourcePath
      } else {
        // Ephemeral script file inside workspace so cwd/imports stay consistent
        cleanupScript = path.join(WORKSPACE_DIR, `.python-run-${Date.now()}.py`)
        await fs.promises.writeFile(cleanupScript, code)
        scriptPath = cleanupScript
      }

      let stdout = ''
      let stderr = ''
      try {
        const result = await execAsync(`"${VENV_PYTHON}" "${scriptPath}"`, {
          timeout: timeoutSec,
          maxBuffer: 10 * 1024 * 1024,
          cwd: WORKSPACE_DIR,
        })
        stdout = result.stdout
        stderr = result.stderr
      } finally {
        if (cleanupScript) {
          await fs.promises.unlink(cleanupScript).catch(() => {})
        }
      }

      const after = snapshotDir(workspaceOutput)
      const published: { original: string; publicName: string; url: string }[] = []

      for (const [name, mtime] of after) {
        const prev = before.get(name)
        if (prev !== undefined && prev >= mtime) continue // unchanged
        if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') continue

        const src = path.join(workspaceOutput, name)
        const publicName = uniquePublicName(name)
        const dest = path.join(PUBLIC_OUTPUT_DIR, publicName)
        fs.copyFileSync(src, dest)
        published.push({
          original: name,
          publicName,
          url: `/uploads/python-out/${publicName}`,
        })
      }

      let outputMessage = stdout.trim() || (stderr ? '' : '(no output)')

      if (stderr) {
        outputMessage += `\n\nStderr:\n${stderr}`
      }

      outputMessage +=
        `\n\n### Environment\n` +
        `- cwd: persistent workspace (\`workspace/\`) — same as terminal & code_edit\n` +
        `- write plots/files to: \`./output/\` (workspace/output/)\n` +
        `- browser URLs: only files listed below under /uploads/python-out/`

      if (published.length > 0) {
        const lines = published.map((p) => {
          const rename =
            p.original !== p.publicName
              ? ` (renamed from \`${p.original}\` to avoid overwrite)`
              : ''
          return `- \`${p.original}\`${rename} → \`${p.url}\`\n  ![${p.publicName}](${p.url})`
        })
        outputMessage +=
          `\n\n### Published files (paste the markdown into your reply)\n${lines.join('\n')}`
      } else {
        outputMessage +=
          '\n\n### Published files\nNone. Save outputs under `./output/` to publish them.'
      }

      return outputMessage
    } catch (error: any) {
      if (error.killed) return `Error: Execution timed out (${timeoutSec / 1000}s limit)`
      return `Error: ${error.message || error.stderr || 'Unknown error'}`
    }
  }
}

export class CodeEditTool extends BaseTool {
  id = 'code_edit'
  name = 'code_edit'
  description = [
    'Write or update a file in the persistent workspace/ directory.',
    'These files survive across tool calls and are visible to both `python` (file_path) and `terminal`.',
    'They are NOT automatically served to the browser — only files written under workspace/output/ and published by the python tool appear at /uploads/python-out/.',
    'After editing a .py file, run it with: python(file_path="your_script.py").',
  ].join(' ')
  parameters = {
    type: 'object',
    properties: {
      file_name: {
        type: 'string',
        description: 'Path relative to workspace/ (e.g. "script.py", "analysis/plot.py").',
      },
      code: {
        type: 'string',
        description: 'Full file contents (overwrites the file).',
      },
    },
    required: ['file_name', 'code'],
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const fileName = args.file_name as string
    const code = args.code as string

    if (!fileName || !code) return 'Error: Both `file_name` and `code` are required'

    try {
      ensureDirs()

      const filePath = resolveWithin(WORKSPACE_DIR, fileName)
      if (!filePath) {
        return `Error: Invalid file_name (must stay within workspace): ${fileName}`
      }

      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, code)

      const size = Buffer.byteLength(code, 'utf8')
      const lines = code.split('\n').length
      const relativeName = path.relative(WORKSPACE_DIR, filePath)

      return (
        `Saved to persistent workspace: \`${relativeName}\` (${lines} lines, ${size} bytes)\n` +
        `Run with: python(file_path="${relativeName}")\n` +
        `Note: this is source code, not a browser URL. For images, have the script write to ./output/ and use the /uploads/python-out/ URL the python tool returns.`
      )
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  }
}
