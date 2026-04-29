import { BaseProvider, CompletionOptions, CompletionChunk } from './base'
import { ChatMessage } from '../types'

export class OpenAIProvider extends BaseProvider {
  id = 'openai'
  name = 'OpenAI'
  type = 'openai'

  constructor(config: { apiKey?: string }) {
    super({ apiKey: config.apiKey || process.env.OPENAI_API_KEY })
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
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
      throw new Error(`OpenAI API error: ${error}`)
    }

    let promptTokens = 0
    let completionTokens = 0

    for await (const chunk of this.streamResponse(response)) {
      if (chunk.generationInfo) {
        promptTokens = chunk.generationInfo.promptTokens || promptTokens
        completionTokens = chunk.generationInfo.completionTokens || completionTokens
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

    return chunk
  }

  private formatMessages(messages: ChatMessage[]): any[] {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.attachments ? {
        content: [
          { type: 'text', text: m.content },
          ...m.attachments.map(a => ({
            type: 'image_url',
            image_url: { url: a.url.startsWith('http') ? a.url : `http://localhost:3456${a.url}` },
          })),
        ],
      } : {}),
    }))
  }
}
