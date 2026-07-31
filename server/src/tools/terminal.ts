import { BaseTool } from './base'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)

const WORKSPACE_DIR = path.join(process.cwd(), 'workspace')

export class TerminalTool extends BaseTool {
  id = 'terminal'
  name = 'terminal'
  description = [
    'Execute a shell command on the host (not a security sandbox). 30s default timeout.',
    'cwd is the persistent workspace/ directory — same place as code_edit and the python tool.',
    'Python plots for the browser still need to go through the python tool\'s ./output → /uploads/python-out/ publish step;',
    'files only in workspace/ are not automatically web-served.',
  ].join(' ')
  parameters = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default 30, max 1800)',
      },
    },
    required: ['command'],
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const command = args.command as string
    const timeoutSec = Math.min(Math.max((args.timeout as number) || 30, 1), 1800) * 1000

    if (!command) return 'Error: No command provided'

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeoutSec,
        maxBuffer: 1024 * 1024,
        cwd: WORKSPACE_DIR,
      })

      if (stderr && !stdout) {
        return `Error: ${stderr.trim()}`
      }

      return stdout.trim() || '(no output)'
    } catch (error: any) {
      if (error.killed) return `Error: Command timed out (${timeoutSec / 1000}s limit)`
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'Error: Output exceeded 1MB limit'
      return `Error: ${error.message || error.stderr || 'Unknown error'}`
    }
  }
}
