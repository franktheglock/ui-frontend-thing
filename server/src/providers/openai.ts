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
    const reasoningEffort = this.getOpenAIReasoningEffort(options.reasoningEffort)

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
        max_tokens: options.maxTokens || undefined,
        top_p: options.topP,
        reasoning_effort: reasoningEffort,
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
    const formatted: any[] = []

    for (const m of messages) {
      if (m.role === 'tool' && m.toolResults && m.toolResults.length > 0) {
        for (const tr of m.toolResults) {
          formatted.push({
            role: 'tool',
            tool_call_id: tr.toolCallId,
            content: tr.result !== undefined ? (typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)) : '',
          })
        }
        continue
      }

      const msg: any = {
        role: m.role,
        content: m.content || null,
      }

      if (m.role === 'assistant' && m.toolCalls) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
          },
        }))
      }
      if (m.attachments && m.attachments.length > 0) {
        msg.content = [
          { type: 'text', text: m.content },
          ...m.attachments.map(a => ({
            type: 'image_url',
            image_url: { url: a.url.startsWith('http') ? a.url : `http://localhost:3456${a.url}` },
          })),
        ]
      }

      formatted.push(msg)
    }

    return formatted
  }
}
