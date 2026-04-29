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

function ensureVenv(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(VENV_PYTHON)) {
      resolve()
      return
    }
    // Try 'python' first, then 'python3'
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

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')

export class PythonTool extends BaseTool {
  id = 'python'
  name = 'python'
  description = 'Execute Python code and return the output. You can install packages via the packages parameter. \n\nIMPORTANT: To save images or files, save them to the "./output" directory. \n\nCRITICAL: To display these images to the user, you MUST use the exact URL format: `/uploads/python-out/<filename>`. \nExample: `![Graph](/uploads/python-out/myplot.png)`. \n\nDO NOT use relative paths like "./output/" or just the filename. For matplotlib, use the "Agg" backend.'
  parameters = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Python code to execute',
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
    required: ['code'],
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const code = args.code as string
    const packages = (args.packages as string[]) || []
    const timeoutSec = Math.min(Math.max((args.timeout as number) || 30, 1), 1800) * 1000

    if (!code) return 'Error: No code provided'

    try {
      await ensureVenv()
      
      // Ensure uploads/output dir exists for serving
      const publicOutputDir = path.join(UPLOADS_DIR, 'python-out')
      if (!fs.existsSync(publicOutputDir)) {
        fs.mkdirSync(publicOutputDir, { recursive: true })
      }

      if (packages.length > 0) {
        await execAsync(`"${VENV_PYTHON}" -m pip install ${packages.map(p => `"${p}"`).join(' ')}`, {
          timeout: 300000,
          maxBuffer: 1024 * 1024,
        })
      }

      // Create a temporary directory for this execution
      const runId = `run-${Date.now()}`
      const tempDir = path.join(process.cwd(), 'tmp', runId)
      const outputDir = path.join(tempDir, 'output')
      const tempScript = path.join(tempDir, 'script.py')
      
      fs.mkdirSync(outputDir, { recursive: true })
      
      // The script will save to ./output/ which is tempDir/output/
      await fs.promises.writeFile(tempScript, code)

      const { stdout, stderr } = await execAsync(`"${VENV_PYTHON}" "${tempScript}"`, {
        timeout: timeoutSec,
        maxBuffer: 1024 * 1024,
        cwd: tempDir, // Run from the temp directory
      })

      // After execution, move files from tempDir/output to publicOutputDir
      const generatedFiles = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : []
      const servedFiles: string[] = []

      for (const file of generatedFiles) {
        const src = path.join(outputDir, file)
        const dest = path.join(publicOutputDir, file)
        // Overwrite if exists, or give unique name? Let's overwrite for simplicity 
        // as the model usually uses descriptive names.
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

      // Cleanup temp dir
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})

      return outputMessage
    } catch (error: any) {
      if (error.killed) return `Error: Execution timed out (${timeoutSec / 1000}s limit)`
      return `Error: ${error.message || error.stderr || 'Unknown error'}`
    }
  }
}
