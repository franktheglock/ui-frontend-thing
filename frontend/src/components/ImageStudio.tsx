import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Download, Eye, ImagePlus, Images, Loader2, Maximize2, PencilLine, Settings2, Sparkles, Trash2, Upload, Wand2, X } from 'lucide-react'
import { useImageStudioStore, type ImageGenerationRecord } from '../stores/imageStudioStore'
import { useUIStore } from '../stores/uiStore'
import { cn, formatDate } from '../lib/utils'
import { getProviderIcon } from '../lib/providerIcons'

interface UploadedAttachment {
  id: string
  url: string
  name: string
  mimeType: string
}

interface HistoryImageItem {
  key: string
  image: ImageGenerationRecord['images'][number]
  imageIndex: number
  imageCount: number
  record: ImageGenerationRecord
}

interface LocalProgressState {
  step: number
  total: number
  isGenerating: boolean
}

const aspectPresets = [
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
  { id: '3:4', label: '3:4' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '21:9', label: '21:9' },
] as const

const megapixelPresets = [0.5, 1, 2, 4] as const

function roundToMultiple(value: number, step: number) {
  return Math.max(step, Math.round(value / step) * step)
}

function deriveDimensions(aspectRatio: string, megapixels: number) {
  const [aspectWidth, aspectHeight] = aspectRatio.split(':').map(Number)
  const pixels = megapixels * 1_000_000
  const width = Math.sqrt(pixels * (aspectWidth / aspectHeight))
  const height = pixels / width
  return {
    width: roundToMultiple(width, 64),
    height: roundToMultiple(height, 64),
  }
}

function getPreviewGridClass(imageCount: number) {
  if (imageCount <= 1) {
    return 'grid-cols-1 justify-items-center'
  }
  if (imageCount === 2) {
    return 'grid-cols-2'
  }
  return 'grid-cols-2 grid-rows-2'
}

async function imageUrlToPngBlob(imageUrl: string) {
  return new Promise<Blob>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'

    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height

      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Canvas context unavailable'))
        return
      }

      context.drawImage(image, 0, 0)
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to create PNG blob for clipboard copy'))
          return
        }

        resolve(blob)
      }, 'image/png')
    }

    image.onerror = () => {
      reject(new Error('Failed to load image for clipboard copy'))
    }

    image.src = imageUrl
  })
}

export function ImageStudio() {
  const {
    settingsLoaded,
    historyLoaded,
    selectedProvider,
    providers,
    history,
    isGenerating,
    error,
    loadSettings,
    loadHistory,
    setSelectedProvider,
    generateImage,
    editImage,
    deleteHistoryImage,
  } = useImageStudioStore()
  const { setSettingsOpen } = useUIStore()

  const [mode, setMode] = useState<'generate' | 'edit'>('generate')
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<typeof aspectPresets[number]['id']>('1:1')
  const [megapixels, setMegapixels] = useState<typeof megapixelPresets[number]>(1)
  const [width, setWidth] = useState(() => deriveDimensions('1:1', 1).width)
  const [height, setHeight] = useState(() => deriveDimensions('1:1', 1).height)
  const [steps, setSteps] = useState(8)
  const [guidanceScale, setGuidanceScale] = useState(3.5)
  const [seed, setSeed] = useState(-1)
  const [variations, setVariations] = useState(1)
  const [previewRecord, setPreviewRecord] = useState<ImageGenerationRecord | null>(null)
  const [sourceImage, setSourceImage] = useState<File | null>(null)
  const [referenceImage, setReferenceImage] = useState<File | null>(null)
  const [historySourceImageUrl, setHistorySourceImageUrl] = useState<string | null>(null)
  const [historySourceImageLabel, setHistorySourceImageLabel] = useState('')
  const [activeCopyMenuKey, setActiveCopyMenuKey] = useState<string | null>(null)
  const [localProgress, setLocalProgress] = useState<LocalProgressState | null>(null)
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false)
  const [expandedHistoryIndex, setExpandedHistoryIndex] = useState<number | null>(null)
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [providerPopupOpen, setProviderPopupOpen] = useState(false)

  const sourcePreviewUrl = useMemo(() => sourceImage ? URL.createObjectURL(sourceImage) : historySourceImageUrl, [historySourceImageUrl, sourceImage])
  const referencePreviewUrl = useMemo(() => referenceImage ? URL.createObjectURL(referenceImage) : null, [referenceImage])

  const activeProvider = useMemo(() => providers.find((provider) => provider.id === selectedProvider), [providers, selectedProvider])

  useEffect(() => {
    if (!settingsLoaded) {
      loadSettings().catch(console.error)
    }
    if (!historyLoaded) {
      loadHistory().catch(console.error)
    }
  }, [historyLoaded, loadHistory, loadSettings, settingsLoaded])

  useEffect(() => {
    if (!previewRecord && history.length > 0) {
      setPreviewRecord(history[0])
    }
  }, [history, previewRecord])

  useEffect(() => {
    return () => {
      if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl)
    }
  }, [sourcePreviewUrl])

  useEffect(() => {
    return () => {
      if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl)
    }
  }, [referencePreviewUrl])

  useEffect(() => {
    const next = deriveDimensions(aspectRatio, megapixels)
    setWidth(next.width)
    setHeight(next.height)
  }, [aspectRatio, megapixels])

  useEffect(() => {
    if (!isGenerating || selectedProvider !== 'local') {
      setLocalProgress(null)
      return
    }

    const controller = new AbortController()

    const pollStatus = async () => {
      try {
        const response = await fetch('/api/images/providers/local/status', {
          signal: controller.signal,
        })
        if (!response.ok) {
          return
        }

        const payload = await response.json()
        const progress = payload?.progress
        if (progress && Number.isFinite(Number(progress.step)) && Number.isFinite(Number(progress.total))) {
          setLocalProgress({
            step: Number(progress.step),
            total: Number(progress.total),
            isGenerating: Boolean(payload?.is_generating),
          })
          return
        }

        setLocalProgress({
          step: 0,
          total: Math.max(steps, 1),
          isGenerating: Boolean(payload?.is_generating),
        })
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          console.error('[image-studio] Failed to poll local progress:', error)
        }
      }

    }

    pollStatus().catch(console.error)
    const intervalId = window.setInterval(() => {
      pollStatus().catch(console.error)
    }, 800)

    return () => {
      controller.abort()
      window.clearInterval(intervalId)
    }
  }, [isGenerating, selectedProvider, steps])

  const previewImages = previewRecord?.images || []
  const ProviderIcon = getProviderIcon(selectedProvider)
  const historyItems = useMemo<HistoryImageItem[]>(() => {
    return history
      .flatMap((record) => record.images.map((image, imageIndex) => ({
        key: `${record.id}:${image.id || imageIndex}`,
        image,
        imageIndex,
        imageCount: record.images.length,
        record,
      })))
  }, [history])
  const visibleHistory = useMemo(() => historyItems.slice(0, 24), [historyItems])
  const selectedPreviewImageId = previewRecord?.images.length === 1 ? previewRecord.images[0]?.id : null

  useEffect(() => {
    if (!isHistoryExpanded) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (expandedHistoryIndex !== null) {
        if (event.key === 'ArrowLeft' && historyItems.length > 1) {
          event.preventDefault()
          setExpandedHistoryIndex((currentIndex) => currentIndex === null ? null : (currentIndex - 1 + historyItems.length) % historyItems.length)
          return
        }

        if (event.key === 'ArrowRight' && historyItems.length > 1) {
          event.preventDefault()
          setExpandedHistoryIndex((currentIndex) => currentIndex === null ? null : (currentIndex + 1) % historyItems.length)
          return
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          setExpandedHistoryIndex(null)
        }
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setIsHistoryExpanded(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandedHistoryIndex, historyItems.length, isHistoryExpanded])

  useEffect(() => {
    if (!isHistoryExpanded) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isHistoryExpanded])

  const previewActionImage = previewImages[0] || null
  const progressTotal = Math.max(localProgress?.total || steps, 1)
  const progressStep = Math.min(localProgress?.step || 0, progressTotal)
  const progressPercent = Math.max(0, Math.min(100, (progressStep / progressTotal) * 100))

  const handleDownloadImage = (imageUrl: string, imageId: string) => {
    const link = document.createElement('a')
    link.href = imageUrl
    link.download = `${imageId || 'generated-image'}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleOpenImage = (imageUrl: string) => {
    window.open(imageUrl, '_blank', 'noopener,noreferrer')
  }

  const handleViewHistoryItem = (item: HistoryImageItem) => {
    setPreviewRecord({
      ...item.record,
      images: [item.image],
    })
  }

  const handleCopyPrompt = async (promptText: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(promptText)
      return
    }

    const textarea = document.createElement('textarea')
    textarea.value = promptText
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }

  const handleCopyImage = async (imageUrl: string) => {
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        const pngBlob = await imageUrlToPngBlob(imageUrl)
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
        return
      }
    } catch {
      // Fall through to DOM-based copy below.
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const container = document.createElement('div')
        container.contentEditable = 'true'
        container.style.position = 'fixed'
        container.style.pointerEvents = 'none'
        container.style.opacity = '0'
        container.style.left = '-9999px'
        container.style.top = '0'

        const image = document.createElement('img')
        image.crossOrigin = 'anonymous'
        image.src = imageUrl

        image.onload = () => {
          container.appendChild(image)
          document.body.appendChild(container)

          const selection = window.getSelection()
          const range = document.createRange()
          range.selectNode(image)
          selection?.removeAllRanges()
          selection?.addRange(range)

          const copied = document.execCommand('copy')

          selection?.removeAllRanges()
          document.body.removeChild(container)

          if (!copied) {
            reject(new Error('DOM image copy failed'))
            return
          }

          resolve()
        }

        image.onerror = () => {
          reject(new Error('Failed to load image for clipboard copy'))
        }
      })
      return
    } catch {
      await handleCopyPrompt(imageUrl)
    }
  }

  const handleEditFromHistory = (item: HistoryImageItem) => {
    setMode('edit')
    setPrompt(item.record.prompt)
    setSourceImage(null)
    setHistorySourceImageUrl(item.image.url)
    setHistorySourceImageLabel(`History image ${item.imageIndex + 1}/${item.imageCount}`)
    handleViewHistoryItem(item)
  }

  const handleOpenExpandedHistory = () => {
    setExpandedHistoryIndex(null)
    setIsHistoryExpanded(true)
  }

  const handleCloseExpandedHistory = () => {
    setExpandedHistoryIndex(null)
    setIsHistoryExpanded(false)
  }

  const handleOpenExpandedHistoryItem = (index: number) => {
    setExpandedHistoryIndex(index)
  }

  const handleCloseExpandedLightbox = () => {
    setExpandedHistoryIndex(null)
  }

  const handleExpandedHistoryStep = (direction: -1 | 1) => {
    if (!historyItems.length) {
      return
    }

    setExpandedHistoryIndex((currentIndex) => {
      const nextIndex = currentIndex === null ? 0 : (currentIndex + direction + historyItems.length) % historyItems.length
      return nextIndex
    })
  }

  const handleDeleteHistoryItem = async (item: HistoryImageItem) => {
    await deleteHistoryImage(item.record.id, item.image.id)
    setActiveCopyMenuKey((currentKey) => currentKey === item.key ? null : currentKey)

    if (selectedPreviewImageId === item.image.id) {
      setPreviewRecord(null)
    }
  }

  const uploadImages = async (files: File[]) => {
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to upload images')
    }
    return Array.isArray(payload.attachments) ? payload.attachments as UploadedAttachment[] : []
  }

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) return

    let result
    if (mode === 'generate') {
      result = await generateImage({
        prompt: trimmedPrompt,
        providerId: selectedProvider,
        width,
        height,
        steps,
        guidanceScale,
        seed,
        variations,
        aspectRatio,
      })
    } else {
      if (!sourceImage && !historySourceImageUrl) {
        throw new Error('Choose a source image for edit mode')
      }

      const uploaded = sourceImage || referenceImage
        ? await uploadImages([...(sourceImage ? [sourceImage] : []), ...(referenceImage ? [referenceImage] : [])])
        : []
      const sourceAttachment = sourceImage ? uploaded[0] : null
      const referenceAttachment = sourceImage ? uploaded[1] : uploaded[0]

      result = await editImage({
        prompt: trimmedPrompt,
        providerId: selectedProvider,
        sourceImageUrl: sourceAttachment?.url || historySourceImageUrl,
        referenceImageUrl: referenceAttachment?.url,
        width,
        height,
        steps,
        guidanceScale,
        seed,
        variations,
        aspectRatio,
      })
    }

    setPreviewRecord({
      id: `preview-${Date.now()}`,
      prompt: trimmedPrompt,
      providerId: result.provider,
      model: result.model,
      images: result.images,
      params: result.params,
      createdAt: Date.now(),
    })
  }

  const expandedHistoryItem = expandedHistoryIndex === null ? null : historyItems[expandedHistoryIndex] || null

  return (
    <div className="relative flex min-h-full flex-1 overflow-visible bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--accent)/0.08),transparent_34%),linear-gradient(180deg,transparent,hsl(var(--accent)/0.03))]" />
      <div className="relative flex min-h-full w-full flex-col gap-3 px-3 py-3 md:px-4 lg:px-5">
        <section className="shrink-0 border border-border bg-card/92">
          <div className="grid w-full gap-0 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="border-b border-border bg-[linear-gradient(180deg,hsl(var(--card))_0%,hsl(var(--background))_100%)] p-4 lg:border-b-0 lg:border-r">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                    <Wand2 className="h-3.5 w-3.5 text-accent" />
                    Image Studio
                  </div>
                  <h1 className="font-serif text-2xl leading-none text-foreground md:text-[2.1rem]">
                    Compose visuals.
                  </h1>
                </div>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="flex items-center gap-2 border border-border bg-secondary/60 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Configure
                </button>
              </div>

              <div className="space-y-4">
                {/* Mode */}
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setMode('generate')}
                      className={cn(
                        'flex items-center justify-center gap-2 border px-2.5 py-1.5 text-[11px] transition-colors',
                        mode === 'generate'
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Text to Image
                    </button>
                    <button
                      onClick={() => setMode('edit')}
                      className={cn(
                        'flex items-center justify-center gap-2 border px-2.5 py-1.5 text-[11px] transition-colors',
                        mode === 'edit'
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Images className="h-3.5 w-3.5" />
                      Image to Image
                    </button>
                  </div>
                </div>

                {/* Mobile-only preview — shown between mode and prompt, hidden on lg+ */}
                <div className="lg:hidden">
                  <div className="flex w-full flex-col">
                    <div className="relative w-full">
                      {previewImages.length > 0 ? (
                        <div className={cn('grid w-full gap-2 overflow-hidden', previewImages.length > 1 ? `h-[55vw] max-h-[400px] ${getPreviewGridClass(previewImages.length)}` : 'h-[55vw] max-h-[400px] grid-cols-1')}>
                          {previewImages.map((image) => (
                            <div key={image.id} className={cn('group relative flex items-center justify-center overflow-hidden', previewImages.length > 1 ? 'h-full min-h-0 border border-border bg-black/30 p-2' : 'h-full w-full')}>
                              <a href={image.url} target="_blank" rel="noreferrer" className="flex h-full w-full items-center justify-center">
                                <img src={image.url} alt={previewRecord?.prompt || 'Generated image'} className="h-full w-full object-contain" />
                              </a>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex h-[55vw] max-h-[400px] w-full flex-col items-center justify-center border border-dashed border-border bg-secondary/10 px-6 text-center">
                          <ImagePlus className="mb-3 h-8 w-8 text-accent" />
                          <p className="text-sm text-foreground">Your next render lands here.</p>
                        </div>
                      )}
                      {isGenerating && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/96">
                          <div className="flex w-full max-w-[340px] flex-col items-center gap-4 border border-border bg-card px-5 py-6 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
                              <Loader2 className="h-5 w-5 animate-spin text-accent" />
                            </div>
                            <div className="space-y-1 text-center">
                              <p className="text-sm font-medium text-foreground">{mode === 'edit' ? 'Editing image' : 'Generating image'}</p>
                              <p className="text-xs text-muted-foreground">Rendering with {activeProvider?.name || 'the selected provider'}.</p>
                            </div>
                            {selectedProvider === 'local' && (
                              <div className="w-full space-y-2">
                                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                  <span>Sampling</span>
                                  <span>{progressStep}/{progressTotal}</span>
                                </div>
                                <div className="h-2 w-full overflow-hidden border border-border bg-secondary/30">
                                  <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progressPercent}%` }} />
                                </div>
                              </div>
                            )}
                            <div className="grid w-full grid-cols-3 gap-2">
                              <div className="h-16 animate-pulse border border-border bg-secondary/40" />
                              <div className="h-16 animate-pulse border border-border bg-secondary/30 [animation-delay:120ms]" />
                              <div className="h-16 animate-pulse border border-border bg-secondary/20 [animation-delay:240ms]" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    {previewActionImage && previewImages.length === 1 && !isGenerating && (
                      <div className="flex gap-1.5 pt-1.5">
                        <button type="button" onClick={() => handleDownloadImage(previewActionImage.url, previewActionImage.id)} className="flex h-8 flex-1 items-center justify-center gap-1.5 border border-border bg-secondary/20 text-xs text-muted-foreground transition-colors hover:text-foreground">
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </button>
                        <button type="button" onClick={() => handleOpenImage(previewActionImage.url)} className="flex h-8 flex-1 items-center justify-center gap-1.5 border border-border bg-secondary/20 text-xs text-muted-foreground transition-colors hover:text-foreground">
                          <Maximize2 className="h-3.5 w-3.5" />
                          Full Size
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Prompt */}
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Prompt</label>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={4}
                    placeholder={mode === 'generate' ? 'Describe the scene, the framing, the material language, the atmosphere, and the details that matter.' : 'Describe how the uploaded image should change while preserving what matters.'}
                    className="w-full resize-none border border-border bg-background/70 px-3 py-2 text-sm leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent"
                  />
                </div>

                {/* Source / Reference images — always visible in edit mode, hidden in generate on mobile */}
                <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2', mode !== 'edit' && 'hidden lg:grid')}>
                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Source Image</label>
                    <label
                      className={cn(
                        'flex items-center justify-center gap-2 border border-dashed px-3 py-2 text-[11px] transition-colors',
                        mode === 'edit'
                          ? 'cursor-pointer border-border bg-secondary/20 text-muted-foreground hover:border-accent/40 hover:text-foreground'
                          : 'cursor-not-allowed border-border/60 bg-secondary/10 text-muted-foreground/45'
                      )}
                    >
                      <Upload className="h-4 w-4" />
                      <span>{sourceImage ? sourceImage.name : (historySourceImageLabel || 'Choose source image')}</span>
                      <input type="file" accept="image/*" className="hidden" disabled={mode !== 'edit'} onChange={(event) => {
                        setHistorySourceImageUrl(null)
                        setHistorySourceImageLabel('')
                        setSourceImage(event.target.files?.[0] || null)
                      }} />
                    </label>
                    {sourcePreviewUrl && (
                      <div className={cn('relative flex items-center justify-center border bg-background/70 p-2', mode === 'edit' ? 'border-border' : 'border-border/60 opacity-55')}>
                        {mode === 'edit' && (
                          <button
                            type="button"
                            onClick={() => {
                              setSourceImage(null)
                              setHistorySourceImageUrl(null)
                              setHistorySourceImageLabel('')
                            }}
                            className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="Clear source image"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <img src={sourcePreviewUrl} alt="Source preview" className="max-h-24 max-w-full object-contain" />
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Reference Image</label>
                    <label
                      className={cn(
                        'flex items-center justify-center gap-2 border border-dashed px-3 py-2 text-[11px] transition-colors',
                        mode === 'edit'
                          ? 'cursor-pointer border-border bg-secondary/20 text-muted-foreground hover:border-accent/40 hover:text-foreground'
                          : 'cursor-not-allowed border-border/60 bg-secondary/10 text-muted-foreground/45'
                      )}
                    >
                      <Upload className="h-4 w-4" />
                      <span>{referenceImage ? referenceImage.name : 'Optional reference image'}</span>
                      <input type="file" accept="image/*" className="hidden" disabled={mode !== 'edit'} onChange={(event) => setReferenceImage(event.target.files?.[0] || null)} />
                    </label>
                    {referencePreviewUrl && (
                      <div className={cn('relative flex items-center justify-center border bg-background/70 p-2', mode === 'edit' ? 'border-border' : 'border-border/60 opacity-55')}>
                        {mode === 'edit' && (
                          <button
                            type="button"
                            onClick={() => setReferenceImage(null)}
                            className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="Clear reference image"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <img src={referencePreviewUrl} alt="Reference preview" className="max-h-24 max-w-full object-contain" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Provider — popup on mobile, full grid on lg+ */}
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Provider</label>

                  {/* Mobile: compact trigger + popup */}
                  <div className="relative lg:hidden">
                    <button
                      type="button"
                      onClick={() => setProviderPopupOpen((v) => !v)}
                      className="flex w-full items-center gap-2.5 border border-border bg-secondary/25 px-2.5 py-2 text-left transition-colors hover:border-accent/30 hover:text-foreground"
                    >
                      {activeProvider ? (
                        <>
                          <ProviderIcon className="h-4 w-4 flex-shrink-0 text-accent" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-medium leading-tight text-foreground">{activeProvider.name}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{activeProvider.model}</div>
                          </div>
                        </>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">No provider enabled</span>
                      )}
                      <ChevronRight className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', providerPopupOpen && 'rotate-90')} />
                    </button>

                    {providerPopupOpen && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setProviderPopupOpen(false)} />
                        <div className="absolute left-0 top-full z-40 mt-1 w-full min-w-[220px] border border-border bg-card shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                          {providers.filter((provider) => provider.enabled).map((provider) => {
                            const Icon = getProviderIcon(provider.id)
                            const active = provider.id === selectedProvider
                            return (
                              <button
                                key={provider.id}
                                type="button"
                                onClick={() => {
                                  setSelectedProvider(provider.id).catch(console.error)
                                  setProviderPopupOpen(false)
                                }}
                                className={cn(
                                  'flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2.5 text-left transition-colors last:border-b-0',
                                  active
                                    ? 'bg-accent/10 text-foreground'
                                    : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground'
                                )}
                              >
                                <Icon className={cn('h-4 w-4 flex-shrink-0', active && 'text-accent')} />
                                <div className="min-w-0">
                                  <div className="truncate text-[12px] font-medium leading-tight text-current">{provider.name}</div>
                                  <div className="truncate text-[11px] text-muted-foreground">{provider.model}</div>
                                </div>
                                {active && <div className="ml-auto h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />}
                              </button>
                            )
                          })}
                          {providers.filter((p) => p.enabled).length === 0 && (
                            <div className="px-3 py-3 text-[12px] text-muted-foreground">No providers enabled. Configure in settings.</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Desktop: full grid, always visible */}
                  <div className="hidden gap-2 lg:grid lg:grid-cols-1 xl:grid-cols-2">
                    {providers.filter((provider) => provider.enabled).map((provider) => {
                      const Icon = getProviderIcon(provider.id)
                      const active = provider.id === selectedProvider
                      return (
                        <button
                          key={provider.id}
                          onClick={() => setSelectedProvider(provider.id).catch(console.error)}
                          className={cn(
                            'flex items-center gap-2.5 border px-2.5 py-2 text-left transition-colors',
                            active
                              ? 'border-accent bg-accent/10 text-foreground'
                              : 'border-border bg-secondary/25 text-muted-foreground hover:border-accent/30 hover:text-foreground'
                          )}
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium leading-tight text-current">{provider.name}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{provider.model}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Mobile "Advanced settings" toggle — hidden on lg+ where all settings are always shown */}
                <button
                  type="button"
                  onClick={() => setMobileSettingsOpen((v) => !v)}
                  className="flex w-full items-center justify-between border border-border bg-secondary/20 px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground lg:hidden"
                >
                  <span>Advanced Settings</span>
                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', mobileSettingsOpen && 'rotate-90')} />
                </button>

                {/* Aspect ratio + megapixels + variations — always visible */}
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Aspect Ratio</label>
                    <div className="flex flex-wrap gap-2">
                      {aspectPresets.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => setAspectRatio(preset.id)}
                          className={cn(
                            'border px-2.5 py-1 text-[11px] transition-colors',
                            aspectRatio === preset.id
                              ? 'border-accent bg-accent text-accent-foreground'
                              : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                        <span>Megapixels</span>
                        <span>{megapixels} MP</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {megapixelPresets.map((preset) => (
                          <button
                            key={preset}
                            onClick={() => setMegapixels(preset)}
                            className={cn(
                              'border px-2 py-1 text-[11px] transition-colors',
                              megapixels === preset
                                ? 'border-accent bg-accent text-accent-foreground'
                                : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
                            )}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{width} × {height}</div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Variations</label>
                      <div className="flex flex-wrap gap-2">
                        {([1, 2, 3, 4] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() => setVariations(v)}
                            className={cn(
                              'border px-2 py-1 text-[11px] transition-colors',
                              variations === v
                                ? 'border-accent bg-accent text-accent-foreground'
                                : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
                            )}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Advanced settings (collapsible on mobile, always shown on lg+) — width/height/steps/guidance/seed */}
                <div className={cn('space-y-4', !mobileSettingsOpen && 'hidden lg:block')}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center justify-between uppercase tracking-[0.18em]">
                        <span>Width</span>
                        <input
                          type="number"
                          min={256}
                          max={4096}
                          step={64}
                          value={width}
                          onChange={(event) => setWidth(roundToMultiple(Number(event.target.value) || 256, 64))}
                          className="w-20 border border-border bg-background/70 px-2 py-1 text-right text-[11px] text-foreground outline-none focus:border-accent"
                        />
                      </span>
                      <input type="range" min={256} max={4096} step={64} value={width} onChange={(event) => setWidth(Number(event.target.value))} className="w-full accent-[hsl(var(--accent))]" />
                    </label>
                    <label className="space-y-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center justify-between uppercase tracking-[0.18em]">
                        <span>Height</span>
                        <input
                          type="number"
                          min={256}
                          max={4096}
                          step={64}
                          value={height}
                          onChange={(event) => setHeight(roundToMultiple(Number(event.target.value) || 256, 64))}
                          className="w-20 border border-border bg-background/70 px-2 py-1 text-right text-[11px] text-foreground outline-none focus:border-accent"
                        />
                      </span>
                      <input type="range" min={256} max={4096} step={64} value={height} onChange={(event) => setHeight(Number(event.target.value))} className="w-full accent-[hsl(var(--accent))]" />
                    </label>
                  </div>

                  <div className={cn('grid gap-3', mode === 'edit' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3')}>
                    <label className="space-y-2 text-xs text-muted-foreground">
                      <span className="block uppercase tracking-[0.18em]">Steps</span>
                      <input type="range" min={1} max={40} step={1} value={steps} onChange={(event) => setSteps(Number(event.target.value))} className="w-full accent-[hsl(var(--accent))]" />
                      <span className="block text-foreground">{steps}</span>
                    </label>
                    <label className="space-y-2 text-xs text-muted-foreground">
                      <span className="block uppercase tracking-[0.18em]">Guidance</span>
                      <input type="range" min={0} max={12} step={0.5} value={guidanceScale} onChange={(event) => setGuidanceScale(Number(event.target.value))} className="w-full accent-[hsl(var(--accent))]" />
                      <span className="block text-foreground">{guidanceScale.toFixed(1)}</span>
                    </label>
                    <label className="space-y-2 text-xs text-muted-foreground">
                      <span className="block uppercase tracking-[0.18em]">Seed</span>
                      <input
                        type="number"
                        value={seed}
                        onChange={(event) => setSeed(Number(event.target.value) || 0)}
                        className="w-full border border-border bg-background/70 px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent"
                      />
                      <span className="block text-[11px] text-muted-foreground">-1 = random</span>
                    </label>
                  </div>
                </div>

                {error && (
                  <div className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !prompt.trim() || !activeProvider || (mode === 'edit' && !sourceImage && !historySourceImageUrl)}
                  className="flex w-full items-center justify-center gap-2 bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {isGenerating ? (mode === 'edit' ? 'Editing…' : 'Generating…') : (mode === 'edit' ? 'Edit Image' : 'Generate Image')}
                </button>
              </div>
            </div>

            <div className="hidden flex-col bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--card))_100%)] lg:flex">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center border border-border bg-secondary/50">
                    <ProviderIcon className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Active Provider</div>
                    <div className="text-sm font-medium text-foreground">{activeProvider?.name || 'No provider enabled'}</div>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{activeProvider?.model || 'Configure in settings'}</div>
                  <div>{previewRecord ? formatDate(previewRecord.createdAt) : 'No render yet'}</div>
                </div>
              </div>

              <div className="flex flex-1 overflow-hidden p-5">
                <div className="relative flex w-full flex-1 justify-center">
                  {previewImages.length > 0 ? (
                    <div
                      className={cn(
                        'grid w-full gap-4 overflow-hidden',
                        previewImages.length > 1
                          ? `h-[50vh] md:h-[70vh] max-h-[780px] ${getPreviewGridClass(previewImages.length)}`
                          : 'h-[50vh] md:h-[70vh] max-h-[780px] grid-cols-1'
                      )}
                    >
                      {previewImages.map((image) => (
                        <div
                          key={image.id}
                          className={cn(
                            'group relative flex items-center justify-center overflow-hidden',
                            previewImages.length > 1
                              ? 'h-full min-h-0 border border-border bg-black/30 p-3'
                              : 'h-full w-full'
                          )}
                        >
                          <a href={image.url} target="_blank" rel="noreferrer" className="flex h-full w-full items-center justify-center">
                            <img src={image.url} alt={previewRecord?.prompt || 'Generated image'} className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" />
                          </a>
                          <div className="absolute right-3 top-3 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => handleDownloadImage(image.url, image.id)}
                              className="flex h-9 w-9 items-center justify-center border border-border bg-background/80 text-muted-foreground transition-colors hover:text-foreground"
                              aria-label="Download image"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenImage(image.url)}
                              className="flex h-9 w-9 items-center justify-center border border-border bg-background/80 text-muted-foreground transition-colors hover:text-foreground"
                              aria-label="Open image full size"
                            >
                              <Maximize2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-[50vh] md:h-[70vh] max-h-[780px] w-full flex-col items-center justify-center border border-dashed border-border bg-secondary/10 px-6 text-center">
                      <ImagePlus className="mb-4 h-10 w-10 text-accent" />
                      <p className="text-sm text-foreground">Your next render lands here.</p>
                      <p className="mt-2 max-w-md text-xs leading-6 text-muted-foreground">
                        Start with a concrete scene description, pick the output shape, and keep the provider choice in your hands.
                      </p>
                    </div>
                  )}

                  {isGenerating && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/96">
                      <div className="flex w-full max-w-[440px] flex-col items-center gap-5 border border-border bg-card px-6 py-7 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
                          <Loader2 className="h-6 w-6 animate-spin text-accent" />
                        </div>
                        <div className="space-y-1 text-center">
                          <p className="text-sm font-medium text-foreground">{mode === 'edit' ? 'Editing image' : 'Generating image'}</p>
                          <p className="text-xs text-muted-foreground">Rendering with {activeProvider?.name || 'the selected provider'}.</p>
                        </div>
                        {selectedProvider === 'local' && (
                          <div className="w-full space-y-2">
                            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                              <span>Sampling</span>
                              <span>{progressStep}/{progressTotal}</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden border border-border bg-secondary/30">
                              <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progressPercent}%` }} />
                            </div>
                          </div>
                        )}
                        <div className="grid w-full grid-cols-3 gap-3">
                          <div className="h-24 animate-pulse border border-border bg-secondary/40" />
                          <div className="h-24 animate-pulse border border-border bg-secondary/30 [animation-delay:120ms]" />
                          <div className="h-24 animate-pulse border border-border bg-secondary/20 [animation-delay:240ms]" />
                        </div>
                      </div>
                    </div>
                  )}

                  {previewActionImage && previewImages.length === 1 && !isGenerating && (
                    <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleDownloadImage(previewActionImage.url, previewActionImage.id)}
                        className="pointer-events-auto flex h-10 items-center gap-2 border border-border bg-background/82 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenImage(previewActionImage.url)}
                        className="pointer-events-auto flex h-10 items-center gap-2 border border-border bg-background/82 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Maximize2 className="h-4 w-4" />
                        Full Size
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="shrink-0 border border-border bg-card/70">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">History</div>
              <div className="mt-1 text-xs text-foreground">Recent generations stay local to this workspace.</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenExpandedHistory}
                disabled={historyItems.length === 0}
                className="flex items-center gap-1.5 border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Expand
              </button>
              <button
                onClick={() => loadHistory().catch(console.error)}
                className="border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="grid auto-rows-max gap-2.5 p-4 grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
            {visibleHistory.map((item) => {
              const Icon = getProviderIcon(item.record.providerId)
              return (
                <div
                  key={item.key}
                  onMouseLeave={() => setActiveCopyMenuKey((currentKey) => currentKey === item.key ? null : currentKey)}
                  className={cn(
                    'group relative overflow-hidden border border-border bg-background/60 text-left transition-colors hover:border-accent/40',
                    selectedPreviewImageId === item.image.id && 'border-accent'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleViewHistoryItem(item)}
                    className="block w-full text-left"
                  >
                  <div className="aspect-square bg-secondary/20 p-2">
                    <img src={item.image.url} alt={item.record.prompt} className="h-full w-full object-contain" />
                  </div>
                  <div className="space-y-1 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Icon className="h-3.5 w-3.5 text-accent" />
                        <span>{item.record.providerId}</span>
                        {item.imageCount > 1 && <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{item.imageIndex + 1}/{item.imageCount}</span>}
                        {item.record.params?.mode === 'edit' && <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Edit</span>}
                      </div>
                      <span className="text-[11px] text-muted-foreground">{formatDate(item.record.createdAt)}</span>
                    </div>
                  </div>
                  </button>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/96 to-transparent px-2 py-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <p className="line-clamp-3 text-[11px] leading-4 text-foreground">{item.record.prompt}</p>
                  </div>
                  <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleViewHistoryItem(item)}
                      className="flex h-7 w-7 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="View history image"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setActiveCopyMenuKey((currentKey) => currentKey === item.key ? null : item.key)
                      }}
                      className="flex h-7 w-7 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Copy options"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditFromHistory(item)}
                      className="flex h-7 w-7 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Edit from history image"
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteHistoryItem(item).catch(console.error)}
                      className="flex h-7 w-7 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                      aria-label="Delete history image"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {activeCopyMenuKey === item.key && (
                    <div className="absolute right-2 top-10 z-10 flex min-w-[132px] flex-col border border-accent/30 bg-card shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleCopyImage(item.image.url).catch(console.error)
                          setActiveCopyMenuKey(null)
                        }}
                        className="border-b border-border px-3 py-2 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-accent/15 hover:text-accent"
                      >
                        Copy Image
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleCopyPrompt(item.record.prompt).catch(console.error)
                          setActiveCopyMenuKey(null)
                        }}
                        className="px-3 py-2 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-accent/15 hover:text-accent"
                      >
                        Copy Prompt
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {visibleHistory.length === 0 && (
              <div className="col-span-2 md:col-span-4 xl:col-span-6 border border-dashed border-border bg-secondary/10 px-5 py-10 text-center text-sm text-muted-foreground">
                No image history yet.
              </div>
            )}
          </div>
        </section>

        {isHistoryExpanded && (
          <div
            className="fixed inset-0 z-[120] bg-background"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                handleCloseExpandedHistory()
              }
            }}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border/70 bg-background px-6 py-5">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">History Gallery</div>
                  <div className="mt-1 text-sm text-foreground">Expanded workspace image history.</div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseExpandedHistory}
                  className="flex h-10 w-10 items-center justify-center border border-border bg-secondary/20 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Close expanded history"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="grid auto-rows-max gap-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                  {historyItems.map((item, index) => {
                    const Icon = getProviderIcon(item.record.providerId)
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleOpenExpandedHistoryItem(index)}
                        className="group overflow-hidden border border-border/80 bg-card/40 text-left transition-colors hover:border-accent/40"
                      >
                        <div className="aspect-square bg-secondary/10 p-2">
                          <img src={item.image.url} alt={item.record.prompt} className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" />
                        </div>
                        <div className="space-y-1 border-t border-border px-3 py-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Icon className="h-3.5 w-3.5 text-accent" />
                            <span>{item.record.providerId}</span>
                            {item.imageCount > 1 && <span>{item.imageIndex + 1}/{item.imageCount}</span>}
                          </div>
                          <p className="line-clamp-2 text-xs leading-5 text-foreground">{item.record.prompt}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {expandedHistoryItem && (
                <div className="absolute inset-0 z-10 bg-background" onClick={handleCloseExpandedLightbox}>
                  <div className="relative flex h-full w-full items-center justify-center px-8 py-8" onClick={(event) => event.stopPropagation()}>
                    {historyItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleExpandedHistoryStep(-1)}
                        className="absolute bottom-24 left-4 z-10 flex h-12 w-12 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:text-foreground md:bottom-auto md:left-6 md:top-1/2 md:-translate-y-1/2"
                        aria-label="Previous history image"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                    )}

                    <div className="relative flex h-full w-full flex-col items-center justify-center gap-5">
                      <button
                        type="button"
                        onClick={handleCloseExpandedLightbox}
                        className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Close history lightbox"
                      >
                        <X className="h-4 w-4" />
                      </button>

                      <div className="flex h-full max-h-[84vh] w-full items-center justify-center">
                        <img src={expandedHistoryItem.image.url} alt={expandedHistoryItem.record.prompt} className="max-h-full max-w-full object-contain" />
                      </div>

                      <div className="flex w-full items-end justify-between gap-4 border-t border-border/70 bg-background px-1 py-3">
                        <p className="line-clamp-3 max-w-3xl text-sm leading-6 text-foreground">{expandedHistoryItem.record.prompt}</p>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              handleEditFromHistory(expandedHistoryItem)
                              handleCloseExpandedHistory()
                            }}
                            className="flex h-10 items-center gap-2 border border-border bg-secondary/20 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <PencilLine className="h-4 w-4" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadImage(expandedHistoryItem.image.url, expandedHistoryItem.image.id)}
                            className="flex h-10 items-center gap-2 border border-border bg-secondary/20 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </button>
                        </div>
                      </div>
                    </div>

                    {historyItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleExpandedHistoryStep(1)}
                        className="absolute bottom-24 right-4 z-10 flex h-12 w-12 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:text-foreground md:bottom-auto md:right-6 md:top-1/2 md:-translate-y-1/2"
                        aria-label="Next history image"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}