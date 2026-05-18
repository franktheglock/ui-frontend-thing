import { Router } from 'express'
import { loadImageSettings, saveImageSettings } from '../image/config'
import { deleteImageGenerationHistoryItem, editImage, generateImages, listImageGenerationHistory, listImageProviderModels, saveImageGenerationRecord } from '../image/service'

const router = Router()

router.get('/settings', async (_req, res) => {
  res.json({ settings: await loadImageSettings() })
})

router.patch('/settings', async (req, res) => {
  const next = await saveImageSettings(req.body || {})
  res.json({ settings: next })
})

router.get('/history', async (req, res) => {
  const limit = Number(req.query.limit) || 48
  res.json({ history: await listImageGenerationHistory(limit) })
})

router.delete('/history/:recordId/images/:imageId', async (req, res) => {
  try {
    await deleteImageGenerationHistoryItem(String(req.params.recordId || ''), String(req.params.imageId || ''))
    res.status(204).send()
  } catch (error: any) {
    res.status(404).json({ error: error.message || 'Failed to delete history image' })
  }
})

router.get('/providers/:id/models', async (req, res) => {
  try {
    const models = await listImageProviderModels(req.params.id as any)
    res.json({ models })
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load image models' })
  }
})

router.get('/providers/:id/status', async (req, res) => {
  try {
    if (req.params.id !== 'local') {
      res.status(404).json({ error: 'Status polling is only available for the local image provider' })
      return
    }

    const settings = await loadImageSettings()
    const provider = settings.providers.find((candidate) => candidate.id === 'local' && candidate.enabled)
    if (!provider) {
      res.status(404).json({ error: 'Local image provider is not configured or enabled' })
      return
    }

    const response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/api/model-status`)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      res.status(502).json({ error: (payload as any).error || 'Failed to fetch local model status' })
      return
    }

    res.json(payload)
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch local image status' })
  }
})

router.get('/providers/:id/progress', async (req, res) => {
  try {
    if (req.params.id !== 'local') {
      res.status(404).json({ error: 'Progress streaming is only available for the local image provider' })
      return
    }

    const settings = await loadImageSettings()
    const provider = settings.providers.find((candidate) => candidate.id === 'local' && candidate.enabled)
    if (!provider) {
      res.status(404).json({ error: 'Local image provider is not configured or enabled' })
      return
    }

    const response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/api/logs`, {
      headers: {
        Accept: 'text/event-stream',
      },
    })

    if (!response.ok || !response.body) {
      res.status(502).json({ error: 'Failed to connect to the local progress stream' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    req.on('close', async () => {
      try {
        await reader.cancel()
      } catch {
        // Ignore cancellation failures on closed connections.
      }
    })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value, { stream: true }))
    }

    res.end()
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to stream local image progress' })
      return
    }

    res.end()
  }
})

router.post('/generate', async (req, res) => {
  try {
    const generated = await generateImages(req.body || {})
    await saveImageGenerationRecord({
      prompt: String(req.body?.prompt || ''),
      providerId: generated.provider.id,
      model: generated.model,
      images: generated.images,
      requestParams: generated.params,
    })

    res.json({
      provider: generated.provider.id,
      model: generated.model,
      images: generated.images,
      params: generated.params,
    })
  } catch (error: any) {
    console.error('[images] Generation failed:', error)
    res.status(500).json({ error: error.message || 'Image generation failed' })
  }
})

router.post('/edit', async (req, res) => {
  try {
    const edited = await editImage(req.body || {})
    await saveImageGenerationRecord({
      prompt: String(req.body?.prompt || ''),
      providerId: edited.provider.id,
      model: edited.model,
      images: edited.images,
      requestParams: edited.params,
    })

    res.json({
      provider: edited.provider.id,
      model: edited.model,
      images: edited.images,
      params: edited.params,
    })
  } catch (error: any) {
    console.error('[images] Edit failed:', error)
    res.status(500).json({ error: error.message || 'Image editing failed' })
  }
})

export default router