import { BaseTool } from './base'
import * as cheerio from 'cheerio'

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
