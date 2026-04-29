import { BaseProvider, CompletionOptions, CompletionChunk } from './base'

export class AnthropicProvider extends BaseProvider {
  id = 'anthropic'
  name = 'Anthropic'
  type = 'anthropic'

  constructor(config: { apiKey?: string }) {
    super({ apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY })
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const systemMessage = options.messages.find(m => m.role === 'system')
    const userMessages = options.messages.filter(m => m.role !== 'system')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature,
        top_p: options.topP,
        system: systemMessage?.content,
        messages: userMessages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
        tools: options.tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        stream: true,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${error}`)
    }

    let inputTokens = 0
    let outputTokens = 0

    for await (const chunk of this.streamResponse(response)) {
      if (chunk.generationInfo) {
        inputTokens = chunk.generationInfo.promptTokens || inputTokens
        outputTokens = chunk.generationInfo.completionTokens || outputTokens
      }
      yield chunk
    }

    yield {
      done: true,
      generationInfo: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        tokensUsed: inputTokens + outputTokens,
      },
    }
  }

  protected parseChunk(data: any): CompletionChunk | null {
    if (data.type === 'content_block_delta') {
      if (data.delta.type === 'thinking_delta') {
        return { thinking: data.delta.thinking }
      }
      if (data.delta.type === 'text_delta') {
        return { content: data.delta.text }
      }
    }

    if (data.type === 'message_start' && data.message?.usage) {
      return {
        generationInfo: {
          promptTokens: data.message.usage.input_tokens,
        },
      }
    }

    if (data.type === 'message_delta' && data.usage) {
      return {
        generationInfo: {
          completionTokens: data.usage.output_tokens,
        },
      }
    }

    return null
  }
}
