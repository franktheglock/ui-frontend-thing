import { BaseProvider } from './base'
import { OpenAICompatibleProvider } from './openai-compatible'
import { OpenAIProvider } from './openai'
import { AnthropicProvider } from './anthropic'
import { OllamaProvider } from './ollama'
import { GeminiProvider } from './gemini'
import { OpenRouterProvider } from './openrouter'
import { LMStudioProvider } from './lmstudio'
import { NimProvider } from './nvidia'
import { OpencodeGoProvider } from './opencode-go'
import { getDb } from '../db'

const providerMap: Record<string, new (options: any) => BaseProvider> = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  ollama: OllamaProvider,
  gemini: GeminiProvider,
  openrouter: OpenRouterProvider,
  lmstudio: LMStudioProvider,
  nvidia: NimProvider,
  'opencode-go': OpencodeGoProvider,
  'openai-compatible': OpenAICompatibleProvider,
}

type ProviderConfigLike = {
  type: string
  base_url?: string | null
  api_key?: string | null
  baseUrl?: string | null
  apiKey?: string | null
}

export function createProviderFromConfig(config: ProviderConfigLike): BaseProvider | null {
  const ProviderClass = providerMap[config.type]
  if (!ProviderClass) return null

  return new ProviderClass({
    baseUrl: config.baseUrl ?? config.base_url ?? undefined,
    apiKey: config.apiKey ?? config.api_key ?? undefined,
  }) as BaseProvider
}

export async function getProvider(id: string): Promise<BaseProvider | null> {
  const db = await getDb()
  const config = await db.get('SELECT * FROM providers WHERE id = ?', id) as any
  if (!config || !config.enabled) return null

  return createProviderFromConfig(config)
}

export function registerProvider(type: string, provider: new (options: any) => BaseProvider) {
  providerMap[type] = provider
}

export function getProviderTypes(): string[] {
  return Object.keys(providerMap)
}

export { BaseProvider, OpenAICompatibleProvider, OpenAIProvider, AnthropicProvider, OllamaProvider, GeminiProvider, OpenRouterProvider, LMStudioProvider, NimProvider, OpencodeGoProvider }
