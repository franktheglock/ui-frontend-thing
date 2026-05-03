import { OpenAICompatibleProvider } from './openai-compatible'

export class OpencodeGoProvider extends OpenAICompatibleProvider {
  id = 'opencode-go'
  name = 'Opencode Go'
  type = 'opencode-go'

  constructor(config: { baseUrl?: string; apiKey?: string }) {
    super({ baseUrl: config.baseUrl || 'https://opencode.ai/zen/go', apiKey: config.apiKey || process.env.OPENCODE_GO_API_KEY })
  }

  protected getRequestHeaders(): Record<string, string> {
    return {
      ...super.getRequestHeaders(),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      'Accept': 'text/event-stream, application/json',
      'Origin': 'https://opencode.ai',
      'Referer': 'https://opencode.ai/',
    }
  }

  protected getModelRequestHeaders(): Record<string, string> {
    return this.getRequestHeaders()
  }
}