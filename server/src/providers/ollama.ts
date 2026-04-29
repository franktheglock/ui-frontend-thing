import { BaseProvider, CompletionOptions, CompletionChunk } from './base'

export class OllamaProvider extends BaseProvider {
  id = 'ollama'
  name = 'Ollama'
  type = 'ollama'

  constructor(config: { baseUrl?: string }) {
    super({ baseUrl: config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434' })
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages.map(m => ({
          role: m.role,
          content: m.content,
          images: m.attachments?.filter(a => a.type === 'image').map(a => 
            a.url.startsWith('http') ? a.url : `http://localhost:3456${a.url}`
          ),
        })),
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
          top_p: options.topP,
        },
        stream: true,
        tools: options.tools?.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Ollama API error: ${error}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let totalDuration = 0
    let loadDuration = 0
    let promptEvalCount = 0
    let evalCount = 0
    let promptEvalDuration = 0
    let evalDuration = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          
          if (data.total_duration) totalDuration = data.total_duration
          if (data.load_duration) loadDuration = data.load_duration
          if (data.prompt_eval_count) promptEvalCount = data.prompt_eval_count
          if (data.eval_count) evalCount = data.eval_count
          if (data.prompt_eval_duration) promptEvalDuration = data.prompt_eval_duration
          if (data.eval_duration) evalDuration = data.eval_duration

          if (data.message?.content) {
            yield { content: data.message.content }
          }

          if (data.message?.tool_calls) {
            yield { toolCalls: data.message.tool_calls }
          }
        } catch {}
      }
    }

    const tokensPerSecond = evalDuration > 0 
      ? Math.round((evalCount / (evalDuration / 1e9)) * 10) / 10 
      : 0

    yield {
      done: true,
      generationInfo: {
        tokensUsed: promptEvalCount + evalCount,
        promptTokens: promptEvalCount,
        completionTokens: evalCount,
        tokensPerSecond,
        totalDuration,
        loadDuration,
        promptEvalDuration,
        evalDuration,
      },
    }
  }

  protected parseChunk(data: any): CompletionChunk | null {
    return null // Handled manually above
  }
}
