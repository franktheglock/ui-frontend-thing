import { ChatMessage, ToolDefinition } from '../types'

export type ReasoningEffort = 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface CompletionOptions {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  topP?: number
  reasoningEffort?: ReasoningEffort
  tools?: ToolDefinition[]
  stream?: boolean
  lastResponseId?: string // Added for stateful providers
  sessionId?: string // Added for tracking/observability
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

  protected getOpenAIReasoningEffort(effort?: ReasoningEffort): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
    if (!effort || effort === 'auto') return undefined
    if (effort === 'max') return 'xhigh'
    if (effort === 'none' || effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh') {
      return effort
    }
    return undefined
  }

  protected getAnthropicReasoningEffort(effort?: ReasoningEffort): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
    if (!effort || effort === 'auto') return undefined
    if (effort === 'none' || effort === 'minimal') return 'low'
    if (effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max') {
      return effort
    }
    return undefined
  }

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
            const providerError =
              parsed?.error?.message ||
              parsed?.error?.metadata?.raw ||
              parsed?.choices?.[0]?.error?.message ||
              parsed?.choices?.[0]?.error
            if (providerError) {
              throw new Error(String(providerError))
            }
            const chunk = this.parseChunk(parsed)
            if (chunk) yield chunk
          } catch (error) {
            if (error instanceof Error) {
              throw error
            }
          }
        }
      }
    }
  }

  protected abstract parseChunk(data: any): CompletionChunk | null
}
