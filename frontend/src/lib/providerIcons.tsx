import React from 'react'
import * as LobeIcons from '@lobehub/icons'
import { Bot } from 'lucide-react'

const iconMap: Record<string, React.ComponentType<any>> = {
  openai: LobeIcons.OpenAI.Avatar,
  anthropic: LobeIcons.Anthropic.Avatar,
  deepseek: LobeIcons.DeepSeek.Avatar,
  google: LobeIcons.Google.Avatar,
  gemini: LobeIcons.Gemini.Avatar,
  grok: LobeIcons.XAI.Avatar,
  xai: LobeIcons.XAI.Avatar,
  meta: LobeIcons.Meta.Avatar,
  llama: LobeIcons.Meta.Avatar,
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
  gpt: LobeIcons.OpenAI.Avatar,
  claude: LobeIcons.Anthropic.Avatar,
}

export function getProviderIcon(provider: string): React.ComponentType<any> {
  const normalized = provider.toLowerCase()
  
  // Skip the first segment (delivery provider) if slashes are present
  // e.g., "openrouter/x-ai/grok" -> search for "x-ai/grok"
  const slashIdx = normalized.indexOf('/')
  const searchString = slashIdx !== -1 ? normalized.slice(slashIdx + 1) : normalized
  
  const key = searchString.replace(/[^a-z0-9]/g, '')

  // 1. Exact match on the model/owner part
  if (iconMap[key]) return iconMap[key]

  // 2. Substring match on the model/owner part
  for (const [k, v] of Object.entries(iconMap)) {
    if (key.includes(k)) return v
  }

  // 3. Fallback: Check the full original string if no match in model part
  const fullKey = normalized.replace(/[^a-z0-9]/g, '')
  for (const [k, v] of Object.entries(iconMap)) {
    if (fullKey.includes(k)) return v
  }
  
  return Bot
}
