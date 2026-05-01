import { OpenAICompatibleProvider } from './openai-compatible'
import { CompletionOptions, CompletionChunk } from './base'

export class NimProvider extends OpenAICompatibleProvider {
  id = 'nvidia'
  name = 'NVIDIA NIM'
  type = 'nvidia'

  constructor(config: { apiKey?: string }) {
    super({ baseUrl: 'https://integrate.api.nvidia.com', apiKey: config.apiKey || process.env.NVIDIA_API_KEY })
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
        max_tokens: options.maxTokens || undefined,
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
        include_reasoning: true,
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
          if (!accumulatedToolCalls[index]) {
            accumulatedToolCalls[index] = { 
              id: tc.id || `call_${index}`, 
              name: tc.function?.name || '', 
              arguments: tc.function?.arguments || '' 
            }
          } else {
            if (tc.function?.arguments) {
              accumulatedToolCalls[index].arguments += tc.function.arguments
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
}
