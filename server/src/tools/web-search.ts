import { BaseTool } from './base'
import * as duckDuckGo from 'duck-duck-scrape'

export class WebSearchTool extends BaseTool {
  id = 'web_search'
  name = 'web_search'
  description = 'Search the web for information. Supports multiple search providers. When you use information from search results in your response, you MUST cite the source inline using [source:n] where n is the result number shown in the output.'
  parameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      num_results: {
        type: 'number',
        description: 'Number of results to return',
      },
    },
    required: ['query'],
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string
    const provider = (args.provider as string) || 'duckduckgo'
    const numResults = (args.num_results as number) || 5
    const config = (args.searchConfig as Record<string, string>) || {}
    const startIndex = (args.startIndex as number) || 0

    try {
      switch (provider) {
        case 'duckduckgo':
          return await this.searchDuckDuckGo(query, numResults, startIndex)
        case 'searxng':
          return await this.searchSearxNG(query, numResults, config, startIndex)
        case 'brave':
          return await this.searchBrave(query, numResults, config, startIndex)
        case 'google':
          return await this.searchGoogle(query, numResults, config, startIndex)
        default:
          return await this.searchDuckDuckGo(query, numResults, startIndex)
      }
    } catch (error: any) {
      return `Search error: ${error.message}`
    }
  }

  private async searchDuckDuckGo(query: string, numResults: number, startIndex: number): Promise<string> {
    const results = await duckDuckGo.search(query, {
      safeSearch: duckDuckGo.SafeSearchType.STRICT,
    })

    const topResults = results.results.slice(0, numResults)
    return topResults.map((r, i) => 
      `${i + 1 + startIndex}. ${r.title}\n   ${r.description}\n   URL: ${r.url}`
    ).join('\n\n')
  }

  private async searchSearxNG(query: string, numResults: number, config: Record<string, string>, startIndex: number): Promise<string> {
    let baseUrl = config.searxngUrl || process.env.SEARXNG_URL || 'http://localhost:8080'
    baseUrl = baseUrl.replace(/\/$/, '')
    const response = await fetch(`${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&safesearch=0`)
    const data = await response.json() as any

    const results = (data.results || []).slice(0, numResults)
    return results.map((r: any, i: number) =>
      `${i + 1 + startIndex}. ${r.title}\n   ${r.content || r.abstract || ''}\n   URL: ${r.url}`
    ).join('\n\n')
  }

  private async searchBrave(query: string, numResults: number, config: Record<string, string>, startIndex: number): Promise<string> {
    const apiKey = config.braveApiKey || process.env.BRAVE_API_KEY
    if (!apiKey) throw new Error('Brave API Key not configured in settings or environment')

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${numResults}`, {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
      },
    })
    const data = await response.json() as any

    const results = (data.web?.results || []).slice(0, numResults)
    return results.map((r: any, i: number) =>
      `${i + 1 + startIndex}. ${r.title}\n   ${r.description}\n   URL: ${r.url}`
    ).join('\n\n')
  }

  private async searchGoogle(query: string, numResults: number, config: Record<string, string>, startIndex: number): Promise<string> {
    const apiKey = config.googleApiKey || process.env.GOOGLE_PSE_API_KEY
    const cx = config.googleCx || process.env.GOOGLE_PSE_CX
    if (!apiKey || !cx) throw new Error('Google API Key or CX not configured in settings or environment')

    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}&num=${numResults}`
    )
    const data = await response.json() as any

    const results = (data.items || []).slice(0, numResults)
    return results.map((r: any, i: number) =>
      `${i + 1 + startIndex}. ${r.title}\n   ${r.snippet}\n   URL: ${r.link}`
    ).join('\n\n')
  }
}
