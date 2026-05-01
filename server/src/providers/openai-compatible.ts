import { BaseProvider, CompletionOptions, CompletionChunk } from './base'
import { ChatMessage } from '../types'

export class OpenAICompatibleProvider extends BaseProvider {
  id = 'openai-compatible'
  name = 'OpenAI Compatible'
  type = 'openai-compatible'
  baseUrl: string

  constructor(config: { baseUrl?: string; apiKey?: string }) {
    super(config)
    let url = config.baseUrl || 'https://api.openai.com'
    // Strip trailing /v1 or /v1/ to avoid double /v1/v1
    url = url.replace(/\/v1\/?$/, '')
    this.baseUrl = url
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages: this.formatMessages(options.messages),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        tools: options.tools?.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        stream: true,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`${this.name} API error: ${error}`)
    }

    let promptTokens = 0
    let completionTokens = 0
    let accumulatedToolCalls: any[] = []

    for await (const chunk of this.streamResponse(response)) {
      if (chunk.generationInfo) {
        promptTokens = chunk.generationInfo.promptTokens || promptTokens
        completionTokens = chunk.generationInfo.completionTokens || completionTokens
      }
      if (chunk.toolCalls) {
        for (const tc of chunk.toolCalls) {
          const index = tc.index ?? 0
          const newArgs = tc.function?.arguments || tc.arguments || ''
          const newName = tc.function?.name || tc.name || ''
          if (!accumulatedToolCalls[index]) {
            accumulatedToolCalls[index] = { 
              id: tc.id || `call_${index}`, 
              name: newName, 
              arguments: newArgs
            }
          } else {
            if (tc.id && !accumulatedToolCalls[index].id) accumulatedToolCalls[index].id = tc.id
            if (newName) accumulatedToolCalls[index].name = newName
            if (newArgs) {
              const existing = accumulatedToolCalls[index].arguments || ''
              accumulatedToolCalls[index].arguments = existing + newArgs
            }
          }
        }
        chunk.toolCalls = accumulatedToolCalls.filter(Boolean)
      }
      yield chunk
    }

    yield {
      done: true,
      generationInfo: {
        promptTokens,
        completionTokens,
        tokensUsed: promptTokens + completionTokens,
      },
    }
  }

  protected parseChunk(data: any): CompletionChunk | null {
    const delta = data.choices?.[0]?.delta
    if (!delta) return null

    const chunk: CompletionChunk = {}

    if (delta.content) {
      chunk.content = delta.content
    }

    if (delta.reasoning_content || delta.reasoning) {
      chunk.thinking = delta.reasoning_content || delta.reasoning
    }

    if (delta.tool_calls) {
      chunk.toolCalls = delta.tool_calls
    }

    if (data.usage) {
      chunk.generationInfo = {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        tokensUsed: data.usage.total_tokens,
      }
    }

    return Object.keys(chunk).length > 0 ? chunk : null
  }

  protected formatMessages(messages: any[]): any[] {
    const formatted: any[] = []
    
    for (const m of messages) {
      const base: any = {
        role: m.role,
        content: m.content || '',
      }

      if (m.attachments && m.attachments.length > 0) {
        base.content = [
          { type: 'text', text: m.content || '' },
          ...m.attachments.map((a: any) => ({
            type: 'image_url',
            image_url: { url: a.url.startsWith('http') ? a.url : `http://localhost:3456${a.url}` },
          })),
        ]
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        base.tool_calls = m.toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments) }
        }))
      }

      formatted.push(base)

      if (m.toolResults && m.toolResults.length > 0) {
        for (const tr of m.toolResults) {
          formatted.push({
            role: 'tool',
            tool_call_id: tr.toolCallId,
            content: tr.result !== undefined ? (typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)) : ''
          })
        }
      }
    }

    return formatted
  }

  async fetchModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
      })
      if (!response.ok) throw new Error('Failed to fetch models')
      const data = await response.json() as any
      return (data.data || []).map((m: any) => m.id).filter((id: string) => id && !id.includes('embed') && !id.includes('tts') && !id.includes('whisper') && !id.includes('dall'))
    } catch {
      return []
    }
  }
}
