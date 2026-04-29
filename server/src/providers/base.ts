import { ChatMessage, ToolDefinition } from '../types'

export interface CompletionOptions {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  topP?: number
  tools?: ToolDefinition[]
  stream?: boolean
  lastResponseId?: string // Added for stateful providers
}

export interface CompletionChunk {
  content?: string
  thinking?: string
  toolCalls?: any[]
  generationInfo?: any
  done?: boolean
  responseId?: string
}

export abstract class BaseProvider {
  abstract id: string
  abstract name: string
  abstract type: string
  baseUrl?: string
  apiKey?: string

  constructor(config: { baseUrl?: string; apiKey?: string }) {
    this.baseUrl = config.baseUrl
    this.apiKey = config.apiKey
  }

  abstract chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk>

  protected async *streamResponse(response: Response): AsyncGenerator<CompletionChunk> {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            const chunk = this.parseChunk(parsed)
            if (chunk) yield chunk
          } catch {}
        }
      }
    }
  }

  protected abstract parseChunk(data: any): CompletionChunk | null
}
