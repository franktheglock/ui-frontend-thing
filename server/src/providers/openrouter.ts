import { OpenAICompatibleProvider } from './openai-compatible'
import { CompletionOptions, CompletionChunk } from './base'

export class OpenRouterProvider extends OpenAICompatibleProvider {
  id = 'openrouter'
  name = 'OpenRouter'
  type = 'openrouter'

  constructor(config: { apiKey?: string }) {
    super({ baseUrl: 'https://openrouter.ai/api', apiKey: config.apiKey || process.env.OPENROUTER_API_KEY })
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
        'HTTP-Referer': 'http://localhost:5183',
        'X-Title': 'AI Chat UI',
        ...(options.sessionId ? { 'X-Session-ID': options.sessionId } : {}),
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
        ...(options.sessionId ? { session_id: options.sessionId } : {}),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`${this.name} API error: ${error}`)
    }

    let promptTokens = 0
    let completionTokens = 0
    let accumulatedToolCalls: any[] = []

    let responseId = ''
    for await (const chunk of this.streamResponse(response)) {
      if (chunk.responseId) responseId = chunk.responseId
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

    let totalCost: number | undefined
    if (responseId && this.apiKey) {
      console.log(`[OpenRouter] Starting cost polling for ${responseId}...`)
      // Poll with retries as OpenRouter can take a moment to calculate final cost
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
          const statsRes = await fetch(`https://openrouter.ai/api/v1/generation?id=${responseId}`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
          })
          
          if (statsRes.ok) {
            const stats = await statsRes.json() as any
            if (stats.data && stats.data.total_cost !== undefined) {
              totalCost = stats.data.total_cost
              console.log(`[OpenRouter] Cost found (attempt ${attempt}): $${totalCost}`)
              break
            } else {
              console.log(`[OpenRouter] Attempt ${attempt}: Cost not yet available in response.`)
            }
          } else {
            console.error(`[OpenRouter] Attempt ${attempt}: API error ${statsRes.status}`)
          }
        } catch (err) {
          console.error(`[OpenRouter] Attempt ${attempt}: Polling failed`, err)
        }
      }
    } else {
      console.warn(`[OpenRouter] Skipping cost poll: Missing responseId (${responseId}) or apiKey`)
    }

    yield {
      done: true,
      generationInfo: {
        promptTokens,
        completionTokens,
        tokensUsed: promptTokens + completionTokens,
        totalCost,
        provider: this.id,
        model: options.model,
      },
    }
  }

  async fetchModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}`, 'HTTP-Referer': 'http://localhost:5183', 'X-Title': 'AI Chat UI' } : {},
      })
      if (!response.ok) throw new Error('Failed to fetch models')
      const data = await response.json() as any
      return (data.data || []).map((m: any) => m.id)
    } catch {
      return []
    }
  }
}
