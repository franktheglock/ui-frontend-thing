import { OpenAICompatibleProvider } from './openai-compatible'
import { CompletionOptions, CompletionChunk } from './base'

export class LMStudioProvider extends OpenAICompatibleProvider {
  id = 'lmstudio'
  name = 'LM Studio'
  type = 'lmstudio'

  constructor(config: { baseUrl?: string }) {
    super({ baseUrl: config.baseUrl || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234' })
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    // LM Studio is stricter about message structure than generic OpenAI-compatible APIs.
    // Key differences:
    // 1. Assistant messages with tool_calls should NOT have a content field (or it must be null)
    // 2. We avoid sending vision content arrays unless absolutely necessary
    const messages = this.formatMessagesForLMStudio(options.messages)

    const body: any = {
      model: options.model,
      messages,
      stream: true,
    }

    if (options.temperature !== undefined) body.temperature = options.temperature
    if (options.topP !== undefined) body.top_p = options.topP
    if (options.maxTokens) body.max_tokens = options.maxTokens

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    }

    console.log('[lmstudio] Request body:', JSON.stringify(body, null, 2))

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[lmstudio] API error response:', errorText)
      console.error('[lmstudio] Request body that failed:', JSON.stringify(body, null, 2))
      throw new Error(`LM Studio API error: ${errorText}`)
    }

    let promptTokens = 0
    let completionTokens = 0
    let tokensPerSecond = 0
    let timeToFirstToken = 0
    let accumulatedToolCalls: any[] = []

    for await (const chunk of this.streamResponse(response)) {
      if (chunk.generationInfo) {
        promptTokens = chunk.generationInfo.promptTokens || promptTokens
        completionTokens = chunk.generationInfo.completionTokens || completionTokens
        tokensPerSecond = chunk.generationInfo.tokensPerSecond || tokensPerSecond
        timeToFirstToken = chunk.generationInfo.timeToFirstToken || timeToFirstToken
      }

      // Accumulate tool calls across streaming chunks (same logic as OpenAICompatibleProvider)
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
        tokensPerSecond,
        timeToFirstToken,
      },
    }
  }

  private formatMessagesForLMStudio(messages: any[]): any[] {
    const formatted: any[] = []

    for (const m of messages) {
      // Skip messages with empty content and no special fields (except for user messages)
      if (m.role === 'user' && (!m.content || m.content === '') && (!m.attachments || m.attachments.length === 0)) {
        continue
      }

      const base: any = {
        role: m.role,
      }

      // For assistant messages with tool calls, LM Studio prefers no content field at all
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        // LM Studio examples show tool call messages without content
        // If there is actual content, we include it as null
        base.content = m.content && m.content.trim() ? m.content : null
        base.tool_calls = m.toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
          }
        }))
      } else if (m.attachments && m.attachments.length > 0) {
        // Vision format - only use if there are actual attachments
        base.content = [
          { type: 'text', text: m.content || '' },
          ...m.attachments.map((a: any) => ({
            type: 'image_url',
            image_url: { url: a.url?.startsWith('http') ? a.url : `http://localhost:3456${a.url}` },
          })),
        ]
      } else {
        base.content = m.content || ''
      }

      formatted.push(base)

      // Add tool results as separate messages
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

  protected parseChunk(data: any): CompletionChunk | null {
    const choice = data.choices?.[0]
    if (!choice && !data.usage && !data.stats) return null

    const chunk: CompletionChunk = {}

    if (choice?.delta) {
      const delta = choice.delta
      if (delta.content) chunk.content = delta.content
      if (delta.reasoning_content) chunk.thinking = delta.reasoning_content
      if (delta.tool_calls) chunk.toolCalls = delta.tool_calls
    }

    // Capture stats from either standard OpenAI 'usage' or LM Studio specific 'stats'
    const stats = data.usage || data.stats
    if (stats) {
      chunk.generationInfo = {
        promptTokens: stats.prompt_tokens || stats.input_tokens,
        completionTokens: stats.completion_tokens || stats.total_output_tokens,
        tokensUsed: (stats.prompt_tokens || stats.input_tokens || 0) + (stats.completion_tokens || stats.total_output_tokens || 0),
        tokensPerSecond: stats.tokens_per_second,
        timeToFirstToken: stats.time_to_first_token_seconds,
      }
    }

    return Object.keys(chunk).length > 0 ? chunk : null
  }

  async fetchModels(): Promise<string[]> {
    // Try native v1 first (recommended by LM Studio docs)
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/models`)
      if (response.ok) {
        const data = await response.json() as any
        if (data.models && Array.isArray(data.models)) {
          return data.models
            .filter((m: any) => m.type === 'llm')
            .map((m: any) => m.key || m.id || m.name)
            .filter(Boolean)
        }
      }
    } catch {}

    // Fallback to OpenAI-compatible endpoint
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`)
      if (response.ok) {
        const data = await response.json() as any
        return (data.data || [])
          .map((m: any) => m.id)
          .filter((id: string) => id && !id.includes('embed'))
      }
    } catch {}

    return []
  }
}
