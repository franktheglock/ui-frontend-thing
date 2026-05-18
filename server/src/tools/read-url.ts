import { BaseTool } from './base'
import * as cheerio from 'cheerio'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

interface Crawl4AiResponse {
  success: boolean
  url: string
  title?: string
  content?: string
  error?: string
}

function execFileAsync(file: string, args: string[], timeout: number) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, { timeout, encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function resolvePythonExecutable() {
  const configured = process.env.CRAWL4AI_PYTHON || process.env.PYTHON_PATH
  if (configured) {
    return configured
  }

  const candidates = [
    path.resolve(process.cwd(), '../.venv/Scripts/python.exe'),
    path.resolve(process.cwd(), '.venv/Scripts/python.exe'),
    path.resolve(__dirname, '../../../.venv/Scripts/python.exe'),
    path.resolve(__dirname, '../../../../.venv/Scripts/python.exe'),
  ]

  const discovered = candidates.find((candidate) => existsSync(candidate))
  return discovered || 'python'
}

async function readWithCrawl4Ai(url: string) {
  const pythonExecutable = resolvePythonExecutable()
  const scriptPath = path.resolve(__dirname, '../../crawl4ai_read_url.py')
  const { stdout } = await execFileAsync(pythonExecutable, [scriptPath, url], 45000)
  const parsed = JSON.parse(stdout.trim() || '{}') as Crawl4AiResponse

  if (!parsed.success) {
    throw new Error(parsed.error || 'Crawl4AI crawl failed')
  }

  return parsed
}

export class ReadURLTool extends BaseTool {
  id = 'read_url'
  name = 'read_url'
  description = 'Fetch and extract the main content from a URL. When you use information from this URL in your response, you MUST cite it inline using [source:n] where n is the source number provided in the result.'
  parameters = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch and read',
      },
    },
    required: ['url'],
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    let url = args.url as string
    if (!url) {
      return 'Error: url parameter is required.'
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }
    const startIndex = (args.startIndex as number) || 0
    const sourceNum = startIndex + 1

    try {
      const crawlResult = await readWithCrawl4Ai(url)
      const title = crawlResult.title?.trim() || 'Untitled page'
      const content = (crawlResult.content || '').trim()
      return `Source ${sourceNum}:\nTitle: ${title}\nURL: ${crawlResult.url || url}\n\n${content}`
    } catch (crawlError: any) {
      console.warn(`[read_url] Crawl4AI failed for ${url}: ${crawlError.message}`)
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const html = await response.text()
      const $ = cheerio.load(html)

      // Remove script and style elements
      $('script, style, nav, header, footer, aside, .advertisement').remove()

      // Try to find main content
      const mainContent = $('main, article, [role="main"], .content, .post-content, .entry-content')
      const text = mainContent.length > 0 ? mainContent.text() : $('body').text()

      // Clean up whitespace
      const cleanText = text
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim()
        .substring(0, 10000) // Limit to 10k chars

      const title = $('title').text().trim()
      return `Source ${sourceNum}:\nTitle: ${title}\nURL: ${url}\n\n${cleanText}`
    } catch (error: any) {
      return `Source ${sourceNum}:\nURL: ${url}\n\nError reading URL: ${error.message}`
    }
  }
}
