import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import { loadImageSettings } from './config'
import { GeneratedImage, ImageEditRequest, ImageGenerationRecord, ImageGenerationRequest, ImageProviderConfig, ImageProviderId } from './types'

const GENERATED_DIR = path.join(process.cwd(), 'uploads', 'generated-images')

if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true })
}

const IMAGE_GEN_TIMEOUT_MS = 300_000 // 5 minutes
const MODEL_LIST_TIMEOUT_MS = 30_000 // 30 seconds

function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = IMAGE_GEN_TIMEOUT_MS) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

type ImageCandidate =
  | { kind: 'url'; value: string }
  | { kind: 'base64'; value: string; mimeType: string }

function joinUrl(baseUrl: string, endpoint: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`
}

function getAspectRatio(width: number, height: number) {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

function mapOpenAISize(width: number, height: number) {
  if (width >= height * 1.2) return '1536x1024'
  if (height >= width * 1.2) return '1024x1536'
  return '1024x1024'
}

function mapGeminiImageSize(width: number, height: number) {
  const longestSide = Math.max(width, height)
  if (longestSide >= 3072) return '4K'
  if (longestSide >= 1536) return '2K'
  if (longestSide <= 512) return '512'
  return '1K'
}

function getExtensionFromMime(mimeType: string) {
  if (mimeType.includes('jpeg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  return 'png'
}

function getMimeTypeFromFilePath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}

async function downloadRemoteImage(url: string): Promise<{ filePath: string; mimeType: string }> {
  let response: Response
  try {
    response = await fetchWithTimeout(url)
  } catch (err: any) {
    throw new Error(`Cannot reach ${url}: ${err.cause?.code || err.message || 'connection failed'}`)
  }
  if (!response.ok) {
    throw new Error(`Failed to download image from ${url}: ${response.status} ${response.statusText}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') || ''
  const ext = contentType.includes('jpeg') ? '.jpg'
    : contentType.includes('webp') ? '.webp'
      : contentType.includes('gif') ? '.gif'
        : '.png'
  const tempFile = path.join(process.cwd(), 'uploads', 'tmp', `remote-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  fs.mkdirSync(path.dirname(tempFile), { recursive: true })
  fs.writeFileSync(tempFile, buffer)
  return { filePath: tempFile, mimeType: contentType || getMimeTypeFromFilePath(tempFile) }
}

export async function uploadToCatbox(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('userhash', '')
  form.append('fileToUpload', new Blob([buffer]), filename)

  const response = await fetchWithTimeout('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form,
  })

  if (!response.ok) {
    throw new Error(`catbox upload failed: ${response.status} ${response.statusText}`)
  }

  const url = (await response.text()).trim()
  if (!url.startsWith('http')) {
    throw new Error(`catbox upload failed: unexpected response: ${url}`)
  }

  return url
}

async function getPublicImageUrl(imageUrl: string): Promise<string> {
  // Already public or base64
  if (imageUrl.startsWith('data:')) return imageUrl
  if (imageUrl.startsWith('http') && !imageUrl.includes('localhost') && !imageUrl.includes('127.0.0.1')) {
    return imageUrl
  }

  // Resolve to local file
  let filePath: string
  if (imageUrl.startsWith('http')) {
    const parsed = new URL(imageUrl)
    filePath = path.join(process.cwd(), parsed.pathname.replace(/^\/+/, ''))
  } else {
    filePath = resolveUploadPathFromUrl(imageUrl)
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Image file not found: ${filePath}`)
  }

  const buffer = fs.readFileSync(filePath)
  const filename = path.basename(filePath)
  return uploadToCatbox(buffer, filename)
}

function resolveUploadPathFromUrl(fileUrl: string) {
  const sanitized = fileUrl.split('?')[0].replace(/^\/+/, '')
  const relativePath = sanitized.replace(/^uploads\//, '')
  const baseDir = path.join(process.cwd(), 'uploads')

  // Try primary path
  const primaryPath = path.join(baseDir, relativePath)
  if (fs.existsSync(primaryPath)) {
    return primaryPath
  }

  // Try without generated-images/ prefix (in case LLM incorrectly added it)
  const withoutGeneratedPrefix = relativePath.replace(/^generated-images\//, '')
  if (withoutGeneratedPrefix !== relativePath) {
    const fallbackPath = path.join(baseDir, withoutGeneratedPrefix)
    if (fs.existsSync(fallbackPath)) {
      return fallbackPath
    }
  }

  // Try basename directly in uploads/
  const basenamePath = path.join(baseDir, path.basename(relativePath))
  if (fs.existsSync(basenamePath)) {
    return basenamePath
  }

  throw new Error(`Image not found: ${fileUrl} (looked in ${primaryPath}${withoutGeneratedPrefix !== relativePath ? `, ${path.join(baseDir, withoutGeneratedPrefix)}` : ''}${basenamePath !== primaryPath ? `, ${basenamePath}` : ''})`)
}

async function createImageFile(fileUrl: string, fallbackName: string) {
  // Handle base64 data URLs
  if (fileUrl.startsWith('data:')) {
    const { mimeType, buffer } = toBufferFromBase64(fileUrl)
    return new File([buffer], fallbackName, { type: mimeType })
  }

  if (fileUrl.startsWith('http')) {
    // For localhost URLs, read from disk directly instead of fetching over HTTP
    if (fileUrl.includes('localhost') || fileUrl.includes('127.0.0.1')) {
      try {
        const parsed = new URL(fileUrl)
        const filePath = path.join(process.cwd(), parsed.pathname.replace(/^\/+/, ''))
        if (fs.existsSync(filePath)) {
          const mimeType = getMimeTypeFromFilePath(filePath)
          const buffer = fs.readFileSync(filePath)
          return new File([buffer], path.basename(filePath) || fallbackName, { type: mimeType })
        }
      } catch {
        // fall through to download
      }
    }
    const { filePath, mimeType } = await downloadRemoteImage(fileUrl)
    const buffer = fs.readFileSync(filePath)
    return new File([buffer], path.basename(filePath) || fallbackName, { type: mimeType })
  }

  const filePath = resolveUploadPathFromUrl(fileUrl)
  const mimeType = getMimeTypeFromFilePath(filePath)
  const buffer = fs.readFileSync(filePath)

  return new File([buffer], path.basename(filePath) || fallbackName, { type: mimeType })
}

function toBufferFromBase64(data: string) {
  const trimmed = data.trim()
  const match = trimmed.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
  if (match) {
    return {
      mimeType: match[1].toLowerCase(),
      buffer: Buffer.from(match[2], 'base64'),
    }
  }

  return {
    mimeType: 'image/png',
    buffer: Buffer.from(trimmed, 'base64'),
  }
}

function collectCandidates(value: unknown, keyHint?: string, out: ImageCandidate[] = []): ImageCandidate[] {
  if (!value) return out

  if (typeof value === 'string') {
    const trimmed = value.trim()
    const normalizedKey = (keyHint || '').toLowerCase()

    if (/^data:image\//i.test(trimmed)) {
      out.push({ kind: 'base64', value: trimmed, mimeType: trimmed.match(/^data:(image\/[a-z0-9.+-]+);base64,/i)?.[1] || 'image/png' })
      return out
    }

    if ((normalizedKey === 'b64_json' || normalizedKey === 'base64' || normalizedKey === 'data') && trimmed.length > 128) {
      out.push({ kind: 'base64', value: trimmed, mimeType: 'image/png' })
      return out
    }

    if ((normalizedKey.includes('url') || normalizedKey === 'uri') && /^https?:\/\//i.test(trimmed)) {
      out.push({ kind: 'url', value: trimmed })
    }

    return out
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectCandidates(item, keyHint, out))
    return out
  }

  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      if (key === 'inlineData' || key === 'inline_data') {
        const inline = nestedValue as Record<string, unknown>
        const data = inline?.data
        const mimeType = typeof inline?.mimeType === 'string'
          ? inline.mimeType
          : typeof inline?.mime_type === 'string'
            ? inline.mime_type
            : 'image/png'
        if (typeof data === 'string' && data.trim()) {
          out.push({ kind: 'base64', value: data, mimeType })
        }
        return
      }

      collectCandidates(nestedValue, key, out)
    })
  }

  return out
}

async function storeCandidate(candidate: ImageCandidate): Promise<GeneratedImage> {
  let buffer: Buffer
  let mimeType = 'image/png'

  if (candidate.kind === 'url') {
    const response = await fetchWithTimeout(candidate.value)
    if (!response.ok) {
      throw new Error(`Failed to download generated image: ${response.status} ${response.statusText}`)
    }
    mimeType = response.headers.get('content-type') || mimeType
    buffer = Buffer.from(await response.arrayBuffer())
  } else {
    const decoded = toBufferFromBase64(candidate.value)
    mimeType = candidate.mimeType || decoded.mimeType
    buffer = decoded.buffer
  }

  const id = uuidv4()
  const filename = `${id}.${getExtensionFromMime(mimeType)}`
  const filePath = path.join(GENERATED_DIR, filename)
  fs.writeFileSync(filePath, buffer)

  return {
    id,
    url: `/uploads/generated-images/${filename}`,
    mimeType,
  }
}

function deleteGeneratedImageFile(image: GeneratedImage) {
  try {
    const filePath = resolveUploadPathFromUrl(image.url)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // Ignore missing files so history cleanup can still succeed.
  }
}

async function parseResponseJson(response: Response) {
  const text = await response.text()
  if (!text) return {}

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(text)
  }
}

async function requestOpenAICompatible(provider: ImageProviderConfig, request: Required<ImageGenerationRequest>, extraHeaders?: Record<string, string>) {
  const response = await fetchWithTimeout(joinUrl(provider.baseUrl, 'images/generations'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: provider.model,
      prompt: request.prompt,
      n: request.variations,
      size: mapOpenAISize(request.width, request.height),
      response_format: 'b64_json',
    }),
  })

  const payload = await parseResponseJson(response)
  if (!response.ok) {
    throw new Error(String((payload as any).error?.message || (payload as any).error || 'Image generation failed'))
  }
  return payload
}

async function requestLocal(provider: ImageProviderConfig, request: Required<ImageGenerationRequest>) {
  const body = new URLSearchParams({
    prompt: request.prompt,
    width: String(request.width),
    height: String(request.height),
    num_inference_steps: String(request.steps),
    guidance_scale: String(request.guidanceScale),
    seed: String(request.seed),
    num_images_per_prompt: String(request.variations),
    model_variant: provider.model || 'bf16',
  })

  const response = await fetchWithTimeout(joinUrl(provider.baseUrl, 'api/generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const payload = await parseResponseJson(response)
  if (!response.ok) {
    throw new Error(String((payload as any).detail || (payload as any).error || 'Local image generation failed'))
  }
  return payload
}

function getFalEditModel(generateModel: string) {
  // If already an edit model, return as-is
  if (generateModel.endsWith('/edit') || generateModel.endsWith('/image-to-image')) return generateModel
  // Strip known generate-only suffixes before appending /edit
  const stripped = generateModel
    .replace(/\/text-to-image$/, '')
    .replace(/\/generate$/, '')
    .replace(/\/+$/, '')
  return `${stripped}/edit`
}

async function requestFal(provider: ImageProviderConfig, request: Required<ImageGenerationRequest>) {
  const endpoint = joinUrl(provider.baseUrl, provider.model)
  const isGrok = provider.model.includes('grok') || provider.model.includes('xai')

  const body: Record<string, unknown> = {
    prompt: request.prompt,
    num_images: request.variations,
    seed: request.seed >= 0 ? request.seed : undefined,
  }

  if (isGrok) {
    if (request.aspectRatio && request.aspectRatio !== 'auto') {
      body.aspect_ratio = request.aspectRatio
    }
    body.resolution = Math.max(request.width, request.height) >= 1536 ? '2k' : '1k'
    body.output_format = 'jpeg'
  } else {
    body.image_size = { width: request.width, height: request.height }
    body.num_inference_steps = request.steps
    body.guidance_scale = request.guidanceScale
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const payload = await parseResponseJson(response)
  if (!response.ok) {
    const detail = (payload as any).detail
    const errPayload = (payload as any).error
    const message = typeof detail === 'string' ? detail
      : typeof errPayload === 'string' ? errPayload
      : typeof errPayload?.message === 'string' ? errPayload.message
      : typeof detail?.message === 'string' ? detail.message
      : typeof (payload as any).message === 'string' ? (payload as any).message
      : `fal gen fail: ${JSON.stringify(payload).slice(0, 500)}`
    throw new Error(message)
  }
  console.log('[fal-gen] response:', JSON.stringify(payload).slice(0, 1000))
  return payload
}

async function resolveImageUrlToDataUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith('data:')) return imageUrl

  let buffer: Buffer
  let mimeType = 'image/png'

  if (imageUrl.startsWith('http')) {
    let response: Response
    try {
      response = await fetchWithTimeout(imageUrl)
    } catch (err: any) {
      throw new Error(`Cannot reach ${imageUrl}: ${err.cause?.code || err.message || 'connection failed'}`)
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${imageUrl}: ${response.status} ${response.statusText}`)
    }
    mimeType = response.headers.get('content-type') || mimeType
    buffer = Buffer.from(await response.arrayBuffer())
  } else {
    const filePath = resolveUploadPathFromUrl(imageUrl)
    mimeType = getMimeTypeFromFilePath(filePath)
    buffer = fs.readFileSync(filePath)
  }

  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

async function requestFalImageEdit(provider: ImageProviderConfig, request: Required<ImageEditRequest>) {
  const editModel = getFalEditModel(provider.model)
  const endpoint = joinUrl(provider.baseUrl, editModel)

  const isLocal = (url: string) => !url.startsWith('http') || url.includes('localhost') || url.includes('127.0.0.1')

  async function resolveImageUrl(url: string): Promise<string> {
    if (!isLocal(url)) return url
    // Use base64 data URL directly — catbox URLs aren't accessible to fal's servers
    return resolveImageUrlToDataUrl(url)
  }

  const body: Record<string, unknown> = {
    prompt: request.prompt,
    image_urls: [await resolveImageUrl(request.sourceImageUrl)],
    num_images: request.variations,
    resolution: Math.max(request.width, request.height) >= 1536 ? '2k' : '1k',
    output_format: 'jpeg',
    seed: request.seed >= 0 ? request.seed : undefined,
  }

  if (request.aspectRatio && request.aspectRatio !== 'auto') {
    body.aspect_ratio = request.aspectRatio
  }

  if (request.referenceImageUrl) {
    body.reference_image_urls = [await resolveImageUrl(request.referenceImageUrl)]
  }
  if (request.strength !== undefined) {
    body.strength = request.strength
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const payload = await parseResponseJson(response)
  if (!response.ok) {
    const detail = (payload as any).detail
    const errPayload = (payload as any).error
    const message = typeof detail === 'string' ? detail
      : typeof errPayload === 'string' ? errPayload
      : typeof errPayload?.message === 'string' ? errPayload.message
      : typeof detail?.message === 'string' ? detail.message
      : typeof (payload as any).message === 'string' ? (payload as any).message
      : `fal edit fail: ${JSON.stringify(payload).slice(0, 500)}`
    throw new Error(message)
  }
  console.log('[fal-edit] response:', JSON.stringify(payload).slice(0, 1000))
  return payload
}

async function requestGemini(provider: ImageProviderConfig, request: Required<ImageGenerationRequest>) {
  const endpoint = `${joinUrl(provider.baseUrl, `models/${provider.model}:generateContent`)}?key=${encodeURIComponent(provider.apiKey)}`
  const aspectRatio = request.aspectRatio || getAspectRatio(request.width, request.height)

  const attempts = [
    {
      contents: [{ parts: [{ text: request.prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        responseFormat: {
          image: {
            aspectRatio,
            imageSize: mapGeminiImageSize(request.width, request.height),
          },
        },
      },
    },
    {
      contents: [{ parts: [{ text: request.prompt }] }],
    },
  ]

  let lastError = 'Gemini image generation failed'
  for (const body of attempts) {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': provider.apiKey,
      },
      body: JSON.stringify(body),
    })

    const payload = await parseResponseJson(response)
    if (response.ok) {
      return payload
    }

    lastError = String((payload as any).error?.message || (payload as any).error || lastError)
  }

  throw new Error(lastError)
}

function requireApiKey(provider: ImageProviderConfig) {
  if (!provider.apiKey.trim()) {
    throw new Error(`${provider.name} is missing an API key`)
  }
}

function normalizeRequest(request: ImageGenerationRequest): Required<ImageGenerationRequest> {
  return {
    prompt: request.prompt.trim(),
    providerId: request.providerId || 'local',
    width: Math.min(Math.max(Number(request.width) || 1024, 256), 4096),
    height: Math.min(Math.max(Number(request.height) || 1024, 256), 4096),
    steps: Math.min(Math.max(Number(request.steps) || 8, 1), 100),
    guidanceScale: Math.min(Math.max(Number(request.guidanceScale) || 3.5, 0), 50),
    seed: Number.isFinite(Number(request.seed)) ? Number(request.seed) : -1,
    variations: Math.min(Math.max(Number(request.variations) || 1, 1), 8),
    aspectRatio: request.aspectRatio || '',
  }
}

function normalizeEditRequest(request: ImageEditRequest): Required<ImageEditRequest> {
  const base = normalizeRequest(request)
  return {
    ...base,
    sourceImageUrl: String(request.sourceImageUrl || '').trim(),
    referenceImageUrl: String(request.referenceImageUrl || '').trim(),
    strength: Math.min(Math.max(Number(request.strength) || 0.8, 0), 1),
  }
}

async function resolveProvider(providerId?: ImageProviderId) {
  const settings = await loadImageSettings()
  const chosenId = providerId || settings.selectedProvider
  const provider = settings.providers.find((candidate) => candidate.id === chosenId)

  if (!provider || !provider.enabled) {
    throw new Error(`Image provider \"${chosenId}\" is not configured or is disabled`)
  }

  return provider
}

async function requestProviderImages(provider: ImageProviderConfig, request: Required<ImageGenerationRequest>) {
  switch (provider.id) {
    case 'local':
      return requestLocal(provider, request)
    case 'fal':
      requireApiKey(provider)
      return requestFal(provider, request)
    case 'openrouter':
      requireApiKey(provider)
      return requestOpenAICompatible(provider, request, {
        'HTTP-Referer': 'http://localhost:3456',
        'X-OpenRouter-Title': 'AI Chat UI',
      })
    case 'grok':
      requireApiKey(provider)
      return requestOpenAICompatible(provider, request)
    case 'openai':
      requireApiKey(provider)
      return requestOpenAICompatible(provider, request)
    case 'gemini':
      requireApiKey(provider)
      return requestGemini(provider, request)
    default:
      throw new Error(`Unsupported image provider: ${provider.id}`)
  }
}

async function requestLocalImageEdit(provider: ImageProviderConfig, request: Required<ImageEditRequest>) {
  const form = new FormData()
  form.append('prompt', request.prompt)
  form.append('image', await createImageFile(request.sourceImageUrl, 'source-image.png'))
  form.append('num_inference_steps', String(request.steps))
  form.append('guidance_scale', String(request.guidanceScale))
  form.append('strength', String(request.strength))
  form.append('seed', String(request.seed))
  form.append('num_images_per_prompt', String(request.variations))
  form.append('model_variant', provider.model || 'bf16')

  if (request.referenceImageUrl) {
    form.append('reference_image', await createImageFile(request.referenceImageUrl, 'reference-image.png'))
  }

  const response = await fetchWithTimeout(joinUrl(provider.baseUrl, 'api/edit'), {
    method: 'POST',
    body: form,
  })

  const payload = await parseResponseJson(response)
  if (!response.ok) {
    throw new Error(String((payload as any).detail || (payload as any).error || 'Local image editing failed'))
  }

  return payload
}

async function requestOpenAIImageEdit(provider: ImageProviderConfig, request: Required<ImageEditRequest>) {
  const form = new FormData()
  form.append('model', provider.model)
  form.append('prompt', request.prompt)
  form.append('n', String(request.variations))
  form.append('size', mapOpenAISize(request.width, request.height))
  form.append('image', await createImageFile(request.sourceImageUrl, 'source-image.png'))

  const response = await fetchWithTimeout(joinUrl(provider.baseUrl, 'images/edits'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: form,
  })

  const payload = await parseResponseJson(response)
  if (!response.ok) {
    throw new Error(String((payload as any).error?.message || (payload as any).error || 'OpenAI image editing failed'))
  }

  return payload
}

async function requestGeminiImageEdit(provider: ImageProviderConfig, request: Required<ImageEditRequest>) {
  const endpoint = `${joinUrl(provider.baseUrl, `models/${provider.model}:generateContent`)}?key=${encodeURIComponent(provider.apiKey)}`
  const aspectRatio = request.aspectRatio || getAspectRatio(request.width, request.height)

  async function getImageData(fileUrl: string) {
    if (fileUrl.startsWith('data:')) {
      const { mimeType, buffer } = toBufferFromBase64(fileUrl)
      return { mime_type: mimeType, data: buffer.toString('base64') }
    }
    if (fileUrl.startsWith('http')) {
      const { filePath, mimeType } = await downloadRemoteImage(fileUrl)
      return { mime_type: mimeType, data: fs.readFileSync(filePath).toString('base64') }
    }
    const filePath = resolveUploadPathFromUrl(fileUrl)
    return { mime_type: getMimeTypeFromFilePath(filePath), data: fs.readFileSync(filePath).toString('base64') }
  }

  const sourceData = await getImageData(request.sourceImageUrl)
  const parts: Array<Record<string, unknown>> = [
    { text: request.prompt },
    { inline_data: sourceData },
  ]

  if (request.referenceImageUrl) {
    const referenceData = await getImageData(request.referenceImageUrl)
    parts.push({ inline_data: referenceData })
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': provider.apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        responseFormat: {
          image: {
            aspectRatio,
            imageSize: mapGeminiImageSize(request.width, request.height),
          },
        },
      },
    }),
  })

  const payload = await parseResponseJson(response)
  if (!response.ok) {
    throw new Error(String((payload as any).error?.message || (payload as any).error || 'Gemini image editing failed'))
  }

  return payload
}

async function requestProviderImageEdit(provider: ImageProviderConfig, request: Required<ImageEditRequest>) {
  switch (provider.id) {
    case 'local':
      return requestLocalImageEdit(provider, request)
    case 'fal':
      requireApiKey(provider)
      return requestFalImageEdit(provider, request)
    case 'openai':
      requireApiKey(provider)
      return requestOpenAIImageEdit(provider, request)
    case 'gemini':
      requireApiKey(provider)
      return requestGeminiImageEdit(provider, request)
    default:
      throw new Error(`${provider.name} does not support image editing in this app yet`)
  }
}

export async function generateImages(input: ImageGenerationRequest) {
  const request = normalizeRequest(input)
  if (!request.prompt) {
    throw new Error('Prompt is required')
  }

  const provider = await resolveProvider(request.providerId)
  const payload = await requestProviderImages(provider, request)
  const candidates = collectCandidates(payload)

  if (candidates.length === 0) {
    throw new Error('The provider response did not include any image payloads')
  }

  const images = await Promise.all(candidates.slice(0, request.variations).map((candidate) => storeCandidate(candidate)))

  return {
    provider,
    model: provider.model,
    images,
    raw: payload,
    params: {
      width: request.width,
      height: request.height,
      steps: request.steps,
      guidanceScale: request.guidanceScale,
      seed: request.seed,
      variations: request.variations,
      aspectRatio: request.aspectRatio || getAspectRatio(request.width, request.height),
    },
  }
}

export async function editImage(input: ImageEditRequest) {
  const request = normalizeEditRequest(input)
  if (!request.prompt) {
    throw new Error('Prompt is required')
  }
  if (!request.sourceImageUrl) {
    throw new Error('Source image is required')
  }

  const provider = await resolveProvider(request.providerId)
  const payload = await requestProviderImageEdit(provider, request)
  const candidates = collectCandidates(payload)

  if (candidates.length === 0) {
    throw new Error('The provider response did not include any edited image payloads')
  }

  const images = await Promise.all(candidates.slice(0, request.variations).map((candidate) => storeCandidate(candidate)))

  return {
    provider,
    model: provider.model,
    images,
    raw: payload,
    params: {
      mode: 'edit',
      width: request.width,
      height: request.height,
      steps: request.steps,
      guidanceScale: request.guidanceScale,
      strength: request.strength,
      seed: request.seed,
      variations: request.variations,
      aspectRatio: request.aspectRatio || getAspectRatio(request.width, request.height),
      sourceImageUrl: request.sourceImageUrl,
      referenceImageUrl: request.referenceImageUrl || undefined,
    },
  }
}

export async function saveImageGenerationRecord(params: {
  prompt: string
  providerId: ImageProviderId
  model: string
  images: GeneratedImage[]
  requestParams: Record<string, unknown>
  userId?: string
}) {
  const db = await getDb()
  const id = uuidv4()
  const createdAt = Date.now()

  // attach user_id if column exists
  try { const cols = await db.all(`PRAGMA table_info(image_generations)`); const hasUser = cols.some((c:any)=>c.name==='user_id'); if (hasUser && (params as any).userId) { await db.run(`INSERT INTO image_generations (id, prompt, provider_id, model, images, params, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, params.prompt, params.providerId, params.model, JSON.stringify(params.images), JSON.stringify(params.requestParams), createdAt, (params as any).userId); return id; } } catch {}
  await db.run(
    `INSERT INTO image_generations (id, prompt, provider_id, model, images, params, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    params.prompt,
    params.providerId,
    params.model,
    JSON.stringify(params.images),
    JSON.stringify(params.requestParams),
    createdAt
  )

  return id
}

export async function listImageGenerationHistory(limit = 48, userId?: string): Promise<ImageGenerationRecord[]> {
  const db = await getDb()
  const rows = userId
    ? await db.all('SELECT * FROM image_generations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId,
    Math.min(Math.max(limit, 1), 200))
    : await db.all(
    'SELECT * FROM image_generations ORDER BY created_at DESC LIMIT ?',
    Math.min(Math.max(limit, 1), 200)
  ) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: String(row.id),
    prompt: String(row.prompt || ''),
    providerId: row.provider_id as ImageProviderId,
    model: String(row.model || ''),
    images: JSON.parse(String(row.images || '[]')),
    params: JSON.parse(String(row.params || '{}')),
    createdAt: Number(row.created_at || 0),
  }))
}

export async function deleteImageGenerationHistoryItem(recordId: string, imageId: string) {
  const db = await getDb()
  const row = await db.get('SELECT * FROM image_generations WHERE id = ?', recordId) as Record<string, unknown> | undefined

  if (!row) {
    throw new Error('History record not found')
  }

  const images = JSON.parse(String(row.images || '[]')) as GeneratedImage[]
  const imageToDelete = images.find((image) => image.id === imageId)

  if (!imageToDelete) {
    throw new Error('History image not found')
  }

  deleteGeneratedImageFile(imageToDelete)

  const nextImages = images.filter((image) => image.id !== imageId)
  if (nextImages.length === 0) {
    await db.run('DELETE FROM image_generations WHERE id = ?', recordId)
    return
  }

  const params = JSON.parse(String(row.params || '{}')) as Record<string, unknown>
  if (typeof params.variations === 'number') {
    params.variations = Math.max(1, nextImages.length)
  }

  await db.run(
    'UPDATE image_generations SET images = ?, params = ? WHERE id = ?',
    JSON.stringify(nextImages),
    JSON.stringify(params),
    recordId
  )
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)))
}

function getFallbackModels(provider: ImageProviderConfig) {
  switch (provider.id) {
    case 'local':
      return uniqueStrings([provider.model, 'bf16'])
    case 'fal':
      return uniqueStrings([
        provider.model,
        'fal-ai/flux/dev',
        'fal-ai/flux/schnell',
        'fal-ai/flux-pro',
        'fal-ai/flux-lora',
        'fal-ai/flux-2-pro',
        'fal-ai/flux/dev/image-to-image',
        'fal-ai/flux-pro/image-to-image',
        'fal-ai/ideogram',
      ])
    case 'openrouter':
      return uniqueStrings([
        provider.model,
        'google/gemini-3.1-flash-image-preview',
        'google/gemini-3-pro-image-preview',
        'google/gemini-2.5-flash-image',
        'openai/gpt-5.4-image-2',
        'openai/gpt-5-image',
        'openai/gpt-5-image-mini',
        'black-forest-labs/flux.2-pro',
        'black-forest-labs/flux.2-flex',
        'recraft/recraft-v4.1',
        'recraft/recraft-v4.1-pro',
        'sourceful/riverflow-v2-pro',
        'sourceful/riverflow-v2-fast',
        'bytedance-seed/seedream-4.5',
      ])
    case 'grok':
      return uniqueStrings([provider.model, 'grok-imagine-image-quality'])
    case 'openai':
      return uniqueStrings([provider.model, 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'dall-e-3'])
    case 'gemini':
      return uniqueStrings([
        provider.model,
        'gemini-3.1-flash-image-preview',
        'gemini-3-pro-image-preview',
        'gemini-2.5-flash-image',
        'imagen-4.0-generate-001',
      ])
    default:
      return uniqueStrings([provider.model])
  }
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS) })
  const payload = await parseResponseJson(response)
  if (!response.ok) {
    throw new Error(String((payload as any).error?.message || (payload as any).error || response.statusText || 'Request failed'))
  }
  return payload
}

async function fetchLocalImageModels(provider: ImageProviderConfig) {
  const payload = await fetchJson(joinUrl(provider.baseUrl, 'api/model-status')) as Record<string, unknown>
  const models = new Set<string>(getFallbackModels(provider))

  const directCandidates = [
    payload.model_variant,
    payload.variant,
    payload.model,
    payload.active_model,
    payload.current_model,
    payload.loaded_variant,
  ]

  directCandidates.forEach((candidate) => {
    if (typeof candidate === 'string' && candidate.trim()) {
      models.add(candidate.trim())
    }
  })

  const variants = [payload.variants, payload.available_variants, payload.models, payload.model_variants]
  variants.forEach((value) => {
    if (Array.isArray(value)) {
      value.forEach((candidate) => {
        if (typeof candidate === 'string' && candidate.trim()) {
          models.add(candidate.trim())
          return
        }

        if (candidate && typeof candidate === 'object') {
          const variant = candidate as Record<string, unknown>
          const variantKey = typeof variant.key === 'string'
            ? variant.key
            : typeof variant.id === 'string'
              ? variant.id
              : typeof variant.name === 'string'
                ? variant.name
                : ''

          if (variantKey.trim()) {
            models.add(variantKey.trim())
          }
        }
      })
    }
  })

  return Array.from(models)
}

async function fetchFalImageModels(_provider: ImageProviderConfig) {
  // Public explore endpoint — no auth required
  const baseUrl = 'https://fal.ai/api/models'
  const allModels: string[] = []

  try {
    // Fetch first page to get total pages
    const firstPage = await fetchJson(`${baseUrl}?categories=text-to-image,image-to-image&page=1&size=40`) as {
      items?: Array<Record<string, unknown>>
      pages?: number
      total?: number
    }

    const totalPages = firstPage.pages || 1

    // Collect models from first page
    if (firstPage.items) {
      allModels.push(
        ...firstPage.items
          .filter((model) => {
            const category = typeof model.category === 'string' ? model.category : ''
            return category === 'text-to-image' || category === 'image-to-image'
          })
          .map((model) => typeof model.id === 'string' ? model.id : '')
          .filter(Boolean)
      )
    }

    // Fetch remaining pages in parallel (up to 15 pages total)
    const remainingPages = Math.min(totalPages, 15) - 1
    if (remainingPages > 0) {
      const pagePromises = Array.from({ length: remainingPages }, (_, i) =>
        fetch(`${baseUrl}?categories=text-to-image,image-to-image&page=${i + 2}&size=40`, { signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS) }).then(async (res) => {
          if (!res.ok) return null
          const payload = (await res.json().catch(() => null)) as { items?: Array<Record<string, unknown>> } | null
          if (!payload?.items) return null
          return payload.items
            .filter((model) => {
              const category = typeof model.category === 'string' ? model.category : ''
              return category === 'text-to-image' || category === 'image-to-image'
            })
            .map((model) => typeof model.id === 'string' ? model.id : '')
            .filter(Boolean)
        }).catch(() => null)
      )

      const results = await Promise.all(pagePromises)
      for (const pageModels of results) {
        if (pageModels) {
          allModels.push(...pageModels)
        }
      }
    }

    return uniqueStrings([...allModels, ...getFallbackModels(_provider)])
  } catch {
    return getFallbackModels(_provider)
  }
}

async function fetchOpenAIImageModels(provider: ImageProviderConfig) {
  const payload = await fetchJson(joinUrl(provider.baseUrl, 'models'), {
    headers: { Authorization: `Bearer ${provider.apiKey}` },
  }) as { data?: Array<{ id?: string }> }

  return uniqueStrings([
    ...((payload.data || []).map((model) => model.id).filter((id) => typeof id === 'string' && /image|dall/i.test(id || ''))),
    ...getFallbackModels(provider),
  ])
}

async function fetchOpenRouterImageModels(provider: ImageProviderConfig) {
  const url = new URL(joinUrl(provider.baseUrl, 'models'))
  url.searchParams.set('output_modalities', 'image')

  const payload = await fetchJson(url.toString(), {
    headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : undefined,
  }) as { data?: Array<{ id?: string }> }

  const models = (payload.data || [])
    .map((model) => model.id || '')
    .filter(Boolean)

  return uniqueStrings([...models, ...getFallbackModels(provider)])
}

async function fetchXAIImageModels(provider: ImageProviderConfig) {
  const payload = await fetchJson(joinUrl(provider.baseUrl, 'models'), {
    headers: { Authorization: `Bearer ${provider.apiKey}` },
  }) as { data?: Array<{ id?: string }> }

  return uniqueStrings([
    ...((payload.data || []).map((model) => model.id).filter((id) => typeof id === 'string' && /imagine|image/i.test(id || ''))),
    ...getFallbackModels(provider),
  ])
}

async function fetchGeminiImageModels(provider: ImageProviderConfig) {
  const endpoint = `${joinUrl(provider.baseUrl, 'models')}?key=${encodeURIComponent(provider.apiKey)}`
  const payload = await fetchJson(endpoint, {
    headers: { 'x-goog-api-key': provider.apiKey },
  }) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> }

  const models = (payload.models || []).map((model) => {
    const name = typeof model.name === 'string' ? model.name.replace(/^models\//, '') : ''
    const supportsGenerate = Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent')
    return supportsGenerate && /image|imagen/i.test(name) ? name : ''
  })

  return uniqueStrings([...models, ...getFallbackModels(provider)])
}

export async function listImageProviderModels(providerId: ImageProviderId): Promise<string[]> {
  const settings = await loadImageSettings()
  const provider = settings.providers.find((candidate) => candidate.id === providerId)

  if (!provider) {
    throw new Error(`Unknown image provider: ${providerId}`)
  }

  try {
    switch (provider.id) {
      case 'local':
        return await fetchLocalImageModels(provider)
      case 'openai':
        if (!provider.apiKey.trim()) return getFallbackModels(provider)
        return await fetchOpenAIImageModels(provider)
      case 'openrouter':
        return await fetchOpenRouterImageModels(provider)
      case 'grok':
        if (!provider.apiKey.trim()) return getFallbackModels(provider)
        return await fetchXAIImageModels(provider)
      case 'gemini':
        if (!provider.apiKey.trim()) return getFallbackModels(provider)
        return await fetchGeminiImageModels(provider)
      case 'fal':
        return await fetchFalImageModels(provider)
      default:
        return getFallbackModels(provider)
    }
  } catch (error) {
    console.error(`[images] Failed to fetch models for ${provider.id}:`, error)
    return getFallbackModels(provider)
  }
}