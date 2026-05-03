import { BaseProvider, CompletionOptions, CompletionChunk } from './base'
import { safeJsonParse } from '../utils/json'

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
    const reasoningEffort = this.getAnthropicReasoningEffort(options.reasoningEffort)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens || 8192,
        temperature: options.temperature,
        top_p: options.topP,
        system: systemMessage?.content,
        messages: userMessages.map(m => {
          const role = m.role === 'user' || m.role === 'tool' ? 'user' : 'assistant'
          const content: any[] = []
          
          if (m.content) {
            content.push({ type: 'text', text: m.content })
          }

          if (m.role === 'assistant' && m.toolCalls) {
            m.toolCalls.forEach(tc => {
              content.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: typeof tc.arguments === 'string' ? safeJsonParse(tc.arguments) : tc.arguments,
              })
            })
          }

          if (m.role === 'tool' && m.toolResults) {
            m.toolResults.forEach(tr => {
              content.push({
                type: 'tool_result',
                tool_use_id: tr.toolCallId,
                content: tr.result,
              })
            })
          }

          return { role, content }
        }),
        tools: options.tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        output_config: reasoningEffort ? { effort: reasoningEffort } : undefined,
        stream: true,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${error}`)
    }

    let inputTokens = 0
    let outputTokens = 0
    let accumulatedToolCalls: any[] = []

    for await (const chunk of this.streamResponse(response)) {
      if (chunk.generationInfo) {
        inputTokens = chunk.generationInfo.promptTokens || inputTokens
        outputTokens = chunk.generationInfo.completionTokens || outputTokens
      }
      // Merge accumulated tool calls into chunk for client
      if (accumulatedToolCalls.length > 0 && !chunk.toolCalls) {
        chunk.toolCalls = accumulatedToolCalls.filter(Boolean)
      } else if (chunk.toolCalls) {
        for (const tc of chunk.toolCalls) {
          const idx = tc.index ?? 0
          const newArgs = tc.function?.arguments || tc.arguments || ''
          if (!accumulatedToolCalls[idx]) {
            accumulatedToolCalls[idx] = { ...tc, arguments: newArgs }
          } else {
            if (tc.function?.name || tc.name) accumulatedToolCalls[idx].name = tc.function?.name || tc.name || accumulatedToolCalls[idx].name
            if (tc.id && !accumulatedToolCalls[idx].id) accumulatedToolCalls[idx].id = tc.id
            if (newArgs) {
              const existing = accumulatedToolCalls[idx].arguments || ''
              if (typeof newArgs === 'string') {
                accumulatedToolCalls[idx].arguments = existing + newArgs
              } else {
                accumulatedToolCalls[idx].arguments = newArgs
              }
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
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        tokensUsed: inputTokens + outputTokens,
      },
    }
  }

  protected parseChunk(data: any): CompletionChunk | null {
    if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
      const block = data.content_block
      return {
        toolCalls: [{
          index: block.index ?? 0,
          id: block.id,
          name: block.name,
          arguments: '',
        }],
      }
    }

    if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
      return {
        toolCalls: [{
          index: data.index ?? 0,
          function: { arguments: data.delta.partial_json },
        }],
      }
    }

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
