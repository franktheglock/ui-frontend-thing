import React from 'react'
import * as LobeIcons from '@lobehub/icons'
import { Sparkles } from 'lucide-react'

const iconMap: Record<string, React.ComponentType<any>> = {
  openai: LobeIcons.OpenAI.Avatar,
  gpt: LobeIcons.OpenAI.Avatar,
  anthropic: LobeIcons.Anthropic.Avatar,
  claude: LobeIcons.Anthropic.Avatar,
  deepseek: LobeIcons.DeepSeek.Avatar,
  google: LobeIcons.Google.Avatar,
  gemini: LobeIcons.Gemini.Avatar,
  grok: LobeIcons.XAI.Avatar,
  xai: LobeIcons.XAI.Avatar,
  "x-ai": LobeIcons.XAI.Avatar,
  meta: LobeIcons.Meta.Avatar,
  llama: LobeIcons.Meta.Avatar,
  llama3: LobeIcons.Meta.Avatar,
  mistral: LobeIcons.Mistral.Avatar,
  perplexity: LobeIcons.Perplexity.Avatar,
  cohere: LobeIcons.Cohere.Avatar,
  replicate: LobeIcons.Replicate.Avatar,
  together: LobeIcons.Together.Avatar,
  fireworks: LobeIcons.Fireworks.Avatar,
  groq: LobeIcons.Groq.Avatar,
  openrouter: LobeIcons.OpenRouter.Avatar,
  lmstudio: LobeIcons.LmStudio.Avatar,
  nvidia: LobeIcons.Nvidia.Avatar,
  ollama: LobeIcons.Ollama.Avatar,
  azure: LobeIcons.Azure.Avatar,
  github: LobeIcons.Github.Avatar,
  huggingface: LobeIcons.HuggingFace.Avatar,
  qwen: LobeIcons.Qwen.Avatar,
  baidu: LobeIcons.Baidu.Avatar,
  tencent: LobeIcons.Tencent.Avatar,
  moonshot: LobeIcons.Moonshot.Avatar,
  minimax: LobeIcons.Minimax.Avatar,
  yi: LobeIcons.Yi.Avatar,
  zeroone: LobeIcons.ZeroOne.Avatar,
  zhipu: LobeIcons.Zhipu.Avatar,
  chatglm: LobeIcons.ChatGLM.Avatar,
  baichuan: LobeIcons.Baichuan.Avatar,
  stepfun: LobeIcons.Stepfun.Avatar,
  infinigence: LobeIcons.Infinigence.Avatar,
  siliconcloud: LobeIcons.SiliconCloud.Avatar,
  sensenova: LobeIcons.SenseNova.Avatar,
  spark: LobeIcons.Spark.Avatar,
  hunyuan: LobeIcons.Hunyuan.Avatar,
  doubao: LobeIcons.Doubao.Avatar,
  kimikimi: LobeIcons.Kimi.Avatar,
  nova: LobeIcons.Nova.Avatar,
  deepinfra: LobeIcons.DeepInfra.Avatar,
  hypers: LobeIcons.Hyperbolic.Avatar,
  cerebro: LobeIcons.Cerebras.Avatar,
  sambanova: LobeIcons.SambaNova.Avatar,
  anyscale: LobeIcons.Anyscale.Avatar,
  lepton: LobeIcons.LeptonAI.Avatar,
  togetherai: LobeIcons.Together.Avatar,
  workersai: LobeIcons.WorkersAI.Avatar,
  cloudflare: LobeIcons.Cloudflare.Avatar,
  googlecloud: LobeIcons.GoogleCloud.Avatar,
  vertexai: LobeIcons.VertexAI.Avatar,
  bedrock: LobeIcons.Bedrock.Avatar,
  ai21: LobeIcons.Ai21.Avatar,
  ai21labs: LobeIcons.Ai21.Avatar,
  jamba: LobeIcons.Ai21.Avatar,
  gemma: LobeIcons.Gemma.Avatar,
}

export function getProviderIcon(provider: string): React.ComponentType<any> {
  const normalized = provider.toLowerCase()
  
  // 1. Check for common substrings directly in the full string first
  if (normalized.includes('openai') || normalized.includes('gpt')) return LobeIcons.OpenAI.Avatar
  if (normalized.includes('anthropic') || normalized.includes('claude')) return LobeIcons.Anthropic.Avatar
  if (normalized.includes('gemini')) return LobeIcons.Gemini.Avatar
  if (normalized.includes('gemma')) return LobeIcons.Gemma.Avatar
  if (normalized.includes('google')) return LobeIcons.Google.Avatar
  if (normalized.includes('meta') || normalized.includes('llama')) return LobeIcons.Meta.Avatar
  if (normalized.includes('mistral')) return LobeIcons.Mistral.Avatar
  if (normalized.includes('x-ai') || normalized.includes('grok') || normalized.includes('xai')) return LobeIcons.XAI.Avatar
  if (normalized.includes('deepseek')) return LobeIcons.DeepSeek.Avatar
  if (normalized.includes('groq')) return LobeIcons.Groq.Avatar
  if (normalized.includes('openrouter')) return LobeIcons.OpenRouter.Avatar
  if (normalized.includes('ollama')) return LobeIcons.Ollama.Avatar
  if (normalized.includes('lmstudio')) return LobeIcons.LmStudio.Avatar
  if (normalized.includes('perplexity')) return LobeIcons.Perplexity.Avatar
  if (normalized.includes('together')) return LobeIcons.Together.Avatar
  if (normalized.includes('nvidia')) return LobeIcons.Nvidia.Avatar

  // 2. Exact match on cleaned search string
  const key = normalized.replace(/[^a-z0-9]/g, '')
  if (iconMap[key]) return iconMap[key]

  // 3. Substring match on the map keys
  for (const [k, v] of Object.entries(iconMap)) {
    if (key.includes(k)) return v
  }
  
  return Sparkles
}
