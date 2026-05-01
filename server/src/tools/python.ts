import { BaseTool } from './base'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'

const execAsync = promisify(exec)

const VENV_DIR = path.join(process.cwd(), '.venv')
const VENV_PYTHON = process.platform === 'win32' 
  ? path.join(VENV_DIR, 'Scripts', 'python.exe')
  : path.join(VENV_DIR, 'bin', 'python')

const WORKSPACE_DIR = path.join(process.cwd(), 'workspace')
const UPLOADS_DIR = path.join(process.cwd(), 'uploads')

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
      }
      else resolve()
    })
  })
}

export class PythonTool extends BaseTool {
  id = 'python'
  name = 'python'
  description = 'Execute Python code and return the output. You can install packages via the packages parameter. \n\nIMPORTANT: To save images or files, save them to the "./output" directory. \n\nCRITICAL: To display these images to the user, you MUST use the exact URL format: `/uploads/python-out/<filename>`. \nExample: `![Graph](/uploads/python-out/myplot.png)`. \n\nDO NOT use relative paths like "./output/" or just the filename. For matplotlib, use the "Agg" backend.'
  parameters = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Python code to execute (optional if file_path is provided)',
      },
      file_path: {
        type: 'string',
        description: 'Path to a Python file in the workspace to execute (e.g. "script.py"). Alternative to inline code.',
      },
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of pip packages to install before running code (e.g. ["numpy", "pandas", "matplotlib"])',
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
      
      const publicOutputDir = path.join(UPLOADS_DIR, 'python-out')
      if (!fs.existsSync(publicOutputDir)) {
        fs.mkdirSync(publicOutputDir, { recursive: true })
      }

      if (packages.length > 0) {
        await execAsync(`"${VENV_PYTHON}" -m pip install ${packages.map(p => `"${p}"`).join(' ')}`, {
          timeout: 300000,
          maxBuffer: 10 * 1024 * 1024,
        })
      }

      const runId = `run-${Date.now()}`
      const tempDir = path.join(process.cwd(), 'tmp', runId)
      const outputDir = path.join(tempDir, 'output')
      const tempScript = path.join(tempDir, 'script.py')
      
      fs.mkdirSync(outputDir, { recursive: true })
      
      if (filePath) {
        // Copy from workspace to temp dir
        const sourcePath = path.join(WORKSPACE_DIR, filePath)
        if (!fs.existsSync(sourcePath)) {
          return `Error: File not found: ${filePath}. Use code_edit to create it first.`
        }
        fs.copyFileSync(sourcePath, tempScript)
      } else {
        await fs.promises.writeFile(tempScript, code)
      }

      const { stdout, stderr } = await execAsync(`"${VENV_PYTHON}" "${tempScript}"`, {
        timeout: timeoutSec,
        maxBuffer: 10 * 1024 * 1024,
        cwd: tempDir,
      })

      const generatedFiles = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : []
      const servedFiles: string[] = []

      for (const file of generatedFiles) {
        const src = path.join(outputDir, file)
        const dest = path.join(publicOutputDir, file)
        fs.copyFileSync(src, dest)
        servedFiles.push(file)
      }

      let outputMessage = stdout.trim() || (stderr ? '' : '(no output)')
      
      if (stderr) {
        outputMessage += `\n\nStderr:\n${stderr}`
      }

      if (servedFiles.length > 0) {
        const fileLinks = servedFiles.map(f => `![${f}](/uploads/python-out/${f})`).join('\n')
        outputMessage += `\n\n### 📁 GENERATED FILES\n**CRITICAL:** To show these to the user, you MUST copy and paste the markdown below exactly as-is into your response:\n\n${fileLinks}`
      }

      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})

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
  description = 'Write or update a Python file in the persistent workspace. Use this for long code that would exceed token limits, or to iteratively edit code across multiple turns. Files persist across tool calls. After editing, use the `python` tool with `file_path` to run it.'
  parameters = {
    type: 'object',
    properties: {
      file_name: {
        type: 'string',
        description: 'The filename to write to (e.g. "script.py", "analysis.py"). Saved in the workspace directory.',
      },
      code: {
        type: 'string',
        description: 'The Python code to write to the file. This completely replaces the file contents.',
      },
    },
    required: ['file_name', 'code'],
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const fileName = args.file_name as string
    const code = args.code as string

    if (!fileName || !code) return 'Error: Both `file_name` and `code` are required'

    try {
      if (!fs.existsSync(WORKSPACE_DIR)) {
        fs.mkdirSync(WORKSPACE_DIR, { recursive: true })
      }

      const filePath = path.join(WORKSPACE_DIR, fileName)
      await fs.promises.writeFile(filePath, code)

      const size = Buffer.byteLength(code, 'utf8')
      const lines = code.split('\n').length
      
      return `File saved: ${fileName} (${lines} lines, ${size} bytes)\nPath: ${filePath}\n\nYou can now run it with: python(file_path="${fileName}")`
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  }
}
