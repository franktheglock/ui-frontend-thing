import { OpenAICompatibleProvider } from './openai-compatible'
import { CompletionOptions, CompletionChunk } from './base'

export class OpenRouterProvider extends OpenAICompatibleProvider {
  id = 'openrouter'
  name = 'OpenRouter'
  type = 'openrouter'
  private static modelsCache:
    | { expiresAt: number; models: Map<string, { supportedParameters: Set<string> }> }
    | null = null

  constructor(config: { apiKey?: string }) {
    super({ baseUrl: 'https://openrouter.ai/api', apiKey: config.apiKey || process.env.OPENROUTER_API_KEY })
  }

  private async getModelCapabilities(modelId: string): Promise<Set<string> | undefined> {
    const now = Date.now()
    const cached = OpenRouterProvider.modelsCache
    if (cached && cached.expiresAt > now) {
      return cached.models.get(modelId)?.supportedParameters
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.apiKey
          ? {
              'Authorization': `Bearer ${this.apiKey}`,
              'HTTP-Referer': 'http://localhost:5183',
              'X-Title': 'AI Chat UI',
            }
          : {},
      })
      if (!response.ok) throw new Error('Failed to fetch OpenRouter models metadata')

      const data = await response.json() as any
      const models = new Map<string, { supportedParameters: Set<string> }>()
      for (const model of data.data || []) {
        models.set(model.id, {
          supportedParameters: new Set((model.supported_parameters || []).map((param: string) => String(param))),
        })
      }

      OpenRouterProvider.modelsCache = {
        expiresAt: now + 5 * 60 * 1000,
        models,
      }

      return models.get(modelId)?.supportedParameters
    } catch {
      return undefined
    }
  }

  private isInsufficientBalanceError(errorText: string): boolean {
    try {
      const parsed = JSON.parse(errorText)
      const raw = parsed?.error?.metadata?.raw
      if (typeof raw === 'string') {
        const nested = JSON.parse(raw)
        const nestedMessage = nested?.error?.message
        if (typeof nestedMessage === 'string' && nestedMessage.toLowerCase().includes('insufficient balance')) {
          return true
        }
      }

      const message = parsed?.error?.message
      return typeof message === 'string' && message.toLowerCase().includes('insufficient balance')
    } catch {
      return errorText.toLowerCase().includes('insufficient balance')
    }
  }

  private async createCompletionResponse(body: Record<string, unknown>): Promise<Response> {
    return fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
        'HTTP-Referer': 'http://localhost:5183',
        'X-Title': 'AI Chat UI',
        ...(body.session_id ? { 'X-Session-ID': String(body.session_id) } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const reasoningEffort = this.getOpenAIReasoningEffort(options.reasoningEffort)
    const supportedParameters = await this.getModelCapabilities(options.model)
    const supportsParameter = (name: string) => !supportedParameters || supportedParameters.has(name)

    const reasoning = supportsParameter('reasoning')
      ? options.reasoningEffort === 'none'
        ? { exclude: true }
        : reasoningEffort
          ? { effort: reasoningEffort }
          : undefined
      : undefined

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.formatMessages(options.messages),
      stream: true,
      ...(options.sessionId ? { session_id: options.sessionId } : {}),
    }

    if (supportsParameter('temperature') && options.temperature !== undefined) {
      body.temperature = options.temperature
    }
    if (supportsParameter('max_tokens') && options.maxTokens) {
      body.max_tokens = options.maxTokens
    }
    if (supportsParameter('top_p') && options.topP !== undefined) {
      body.top_p = options.topP
    }
    if (supportsParameter('tools') && options.tools?.length) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    }
    if (reasoning) {
      body.reasoning = reasoning
    } else if (options.reasoningEffort === 'none' && supportsParameter('include_reasoning')) {
      body.include_reasoning = false
    }

    let response = await this.createCompletionResponse(body)

    if (!response.ok) {
      const error = await response.text()
      if (body.tools && this.isInsufficientBalanceError(error)) {
        const retryBody = { ...body }
        delete retryBody.tools
        response = await this.createCompletionResponse(retryBody)
        if (response.ok) {
          body.tools = undefined
        } else {
          const retryError = await response.text()
          throw new Error(`${this.name} API error: ${retryError}`)
        }
      } else {
        throw new Error(`${this.name} API error: ${error}`)
      }
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

    // Yield final tokens and responseId immediately to end the stream fast
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
