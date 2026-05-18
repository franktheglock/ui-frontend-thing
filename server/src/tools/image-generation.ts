import { BaseTool } from './base'
import { generateImages, editImage, saveImageGenerationRecord } from '../image/service'
import fs from 'fs'
import path from 'path'

function saveBase64ToFile(dataUrl: string): { filePath: string; urlPath: string } {
  const match = dataUrl.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i)
  if (!match) throw new Error('Invalid base64 data URL')
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  const buffer = Buffer.from(match[2], 'base64')

  const baseDir = path.join(process.cwd(), 'uploads', 'generated-images')
  fs.mkdirSync(baseDir, { recursive: true })
  const filename = `base64-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const filePath = path.join(baseDir, filename)
  fs.writeFileSync(filePath, buffer)
  return { filePath, urlPath: `/uploads/generated-images/${filename}` }
}

export class ImageGenerationTool extends BaseTool {
  id = 'generate_image'
  name = 'generate_image'
  description = 'Generate or edit images using the configured image provider. Use this when the user asks for an illustration, concept art, a mockup, or any visual asset. If the user uploaded an image as an attachment, copy the image_url value from the message content and pass it as sourceImageUrl to edit that image. You can also pass a base64 data URI (data:image/...;base64,...) as sourceImageUrl. If no sourceImageUrl is provided, the tool generates a new image from scratch.'
  parameters = {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'A detailed prompt describing the image to generate or the edit to apply.',
      },
      sourceImageUrl: {
        type: 'string',
        description: 'URL of the image to edit. Use the image_url value from the user message if they attached an image. Also accepts local file paths like /uploads/... or base64 data URIs.',
      },
      referenceImageUrl: {
        type: 'string',
        description: 'Optional reference image URL for style transfer or inpainting (supported by some providers).',
      },
      strength: {
        type: 'number',
        description: 'How much to transform the source image. 0 = minimal change, 1 = maximum change. Defaults to 0.8.',
      },
      width: {
        type: 'number',
        description: 'Requested width in pixels. Defaults to 1024.',
      },
      height: {
        type: 'number',
        description: 'Requested height in pixels. Defaults to 1024.',
      },
      guidanceScale: {
        type: 'number',
        description: 'Guidance strength when supported by the provider.',
      },
      variations: {
        type: 'number',
        description: 'How many images to generate or edit. Defaults to 1.',
      },
      seed: {
        type: 'number',
        description: 'Seed. Use -1 for random.',
      },
    },
    required: ['prompt'],
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    let sourceImageUrl = String(args.sourceImageUrl || '').trim()

    // Convert base64 data URLs to local files before passing to providers
    if (sourceImageUrl.startsWith('data:image/')) {
      const { urlPath } = saveBase64ToFile(sourceImageUrl)
      sourceImageUrl = urlPath
    }

    if (sourceImageUrl) {
      const generated = await editImage({
        prompt: String(args.prompt || ''),
        sourceImageUrl,
        referenceImageUrl: String(args.referenceImageUrl || '').trim() || undefined,
        strength: Number(args.strength),
        width: Number(args.width),
        height: Number(args.height),
        guidanceScale: Number(args.guidanceScale),
        variations: Number(args.variations),
        seed: Number(args.seed),
      })

      await saveImageGenerationRecord({
        prompt: String(args.prompt || ''),
        providerId: generated.provider.id,
        model: generated.model,
        images: generated.images,
        requestParams: generated.params,
      })

      const lines = [
        `Edited image with ${generated.provider.name} (${generated.model}).`,
        '',
        'Edited image URLs:',
        ...generated.images.map((image, index) => `${index + 1}. ${image.url}`),
        '',
        'Use these local URLs directly in Markdown image syntax if you want them displayed inline. Do not embed raw base64 data in the response.',
      ]

      return lines.join('\n')
    }

    const generated = await generateImages({
      prompt: String(args.prompt || ''),
      width: Number(args.width),
      height: Number(args.height),
      guidanceScale: Number(args.guidanceScale),
      variations: Number(args.variations),
      seed: Number(args.seed),
    })

    await saveImageGenerationRecord({
      prompt: String(args.prompt || ''),
      providerId: generated.provider.id,
      model: generated.model,
      images: generated.images,
      requestParams: generated.params,
    })

    const lines = [
      `Generated ${generated.images.length} image${generated.images.length === 1 ? '' : 's'} with ${generated.provider.name} (${generated.model}).`,
      '',
      'Image URLs:',
      ...generated.images.map((image, index) => `${index + 1}. ${image.url}`),
      '',
      'Use these local URLs directly in Markdown image syntax if you want them displayed inline. Do not embed raw base64 data in the response.',
    ]

    return lines.join('\n')
  }
}