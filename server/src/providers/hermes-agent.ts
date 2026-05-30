import { BaseProvider, CompletionOptions, CompletionChunk } from './base'

export class HermesAgentProvider extends BaseProvider {
  id = 'hermes-agent'
  name = 'Hermes Agent'
  type = 'hermes-agent'

  protected getRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    return headers
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const body: Record<string, any> = {
      model: 'hermes-agent',
      messages: await this.formatMessages(options.messages),
      stream: true,
    }

    if (options.lastResponseId) {
      body.previous_response_id = options.lastResponseId
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.getRequestHeaders(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Hermes Agent API error: ${error}`)
    }

    let promptTokens = 0
    let completionTokens = 0
    let lastGenInfo: Record<string, any> = {}

    for await (const chunk of this.streamResponse(response)) {
      if (chunk.generationInfo) {
        promptTokens = chunk.generationInfo.promptTokens || promptTokens
        completionTokens = chunk.generationInfo.completionTokens || completionTokens
        lastGenInfo = { ...lastGenInfo, ...chunk.generationInfo }
      }
      yield chunk
    }

    yield {
      done: true,
      generationInfo: {
        promptTokens,
        completionTokens,
        tokensUsed: promptTokens + completionTokens,
        tokensPerSecond: lastGenInfo.tokensPerSecond,
        totalDuration: lastGenInfo.totalDuration,
        provider: this.id,
        model: 'hermes-agent',
      },
    }
  }

  protected parseChunk(data: any): CompletionChunk | null {
    // Handle Hermes custom tool progress events: data has tool + status, no choices
    if (data && data.tool && data.status && !data.choices) {
      const status = data.status
      const tool = data.tool
      const label = data.label || data.query || ''
      const emoji = data.emoji || '⚡'
      if (status === 'running') {
        return {
          content: `\n\n> ${emoji} **\`${tool}\`:** ${label}...\n\n`,
        }
      }
      if (status === 'completed') {
        return {
          content: `\n\n> ✅ **\`${tool}\`** completed\n\n`,
        }
      }
      if (status === 'error') {
        return {
          content: `\n\n> ❌ **\`${tool}\`** failed\n\n`,
        }
      }
      return null
    }

    const delta = data.choices?.[0]?.delta
    if (!delta && !data.choices?.[0]) {
      if (data.id && !data.choices) {
        return null
      }
      return null
    }

    const chunk: CompletionChunk = {
      responseId: data.id,
    }

    if (delta?.content) {
      chunk.content = delta.content
    }

    // Handle thinking/reasoning content
    if (delta?.reasoning_content || delta?.reasoning) {
      chunk.thinking = delta.reasoning_content || delta.reasoning
    }

    // Handle tool calls from the streaming response
    if (delta?.tool_calls) {
      chunk.toolCalls = delta.tool_calls.map((tc: any) => ({
        index: tc.index,
        id: tc.id,
        type: tc.type || 'function',
        function: tc.function || { name: '', arguments: '' },
      }))
    }

    if (data.usage) {
      chunk.generationInfo = {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        tokensUsed: data.usage.total_tokens,
      }
    }

    if (data.timings) {
      if (!chunk.generationInfo) chunk.generationInfo = {}
      chunk.generationInfo = {
        ...chunk.generationInfo,
        promptTokens: data.timings.prompt_n,
        completionTokens: data.timings.predicted_n,
        tokensUsed: (data.timings.prompt_n || 0) + (data.timings.predicted_n || 0),
        tokensPerSecond: data.timings.predicted_per_second,
        promptPerSecond: data.timings.prompt_per_second,
        totalDuration: data.timings.predicted_ms,
      }
    }

    return Object.keys(chunk).length > 0 ? chunk : null
  }

  private summarizeArgs(args: any): string {
    try {
      if (!args) return ''
      const obj = typeof args === 'string' ? JSON.parse(args) : args
      const keys = Object.keys(obj).filter(k => {
        const v = String(obj[k] || '')
        return v.length < 100 && !v.startsWith('data:image') && !v.startsWith('http')
      })
      if (keys.length === 0) return ''
      return ` — ${keys.map(k => `${k}=${obj[k]}`).join(', ')}`
    } catch {
      return ''
    }
  }

  async fetchModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.getRequestHeaders(),
      })
      if (!response.ok) return ['hermes-agent']
      const data = await response.json() as any
      const models = (data.data || []).map((m: any) => m.id)
      return models.length > 0 ? models : ['hermes-agent']
    } catch {
      return ['hermes-agent']
    }
  }

  private async formatMessages(messages: any[]): Promise<any[]> {
    const formatted: any[] = []

    for (const m of messages) {
      const base: any = {
        role: m.role,
        content: m.content || '',
      }

      if (m.role === 'assistant' && m.thinking) {
        base.reasoning_content = m.thinking
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        base.tool_calls = m.toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
          },
        }))
      }

      formatted.push(base)

      if (m.toolResults && m.toolResults.length > 0) {
        for (const tr of m.toolResults) {
          formatted.push({
            role: 'tool',
            tool_call_id: tr.toolCallId,
            content: tr.result !== undefined
              ? (typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result))
              : '',
          })
        }
      }
    }

    return formatted
  }
}
