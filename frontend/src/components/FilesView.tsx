import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, FileIcon, ImageIcon, FileText, X, ChevronLeft, ChevronRight, Upload, FileSpreadsheet, Loader2, PencilLine, MessageSquare } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { useUIStore, getPathnameForView } from '../stores/uiStore'
import { useImageStudioStore } from '../stores/imageStudioStore'
import { formatFileSize } from '../lib/utils'

interface UploadedFile {
  name: string
  path: string
  size: number
  mtime: string
  type: string
  ext: string
}

interface FileSession {
  id: string
  title: string
  updatedAt: number
}

interface FileSessionsInfo {
  loading: boolean
  sessions: FileSession[]
  error: string | null
}

export function FilesView() {
  const navigate = useNavigate()
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null)
  const [previewIndex, setPreviewIndex] = useState(-1)
  const [attaching, setAttaching] = useState(false)
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null)
  const [fileSessions, setFileSessions] = useState<FileSessionsInfo>({ loading: false, sessions: [], error: null })
  const { currentSessionId } = useChatStore()
  const { setCurrentView } = useUIStore()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/upload/list')
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setFiles(Array.isArray(data.files) ? data.files : [])
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load uploads')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files
    const q = searchQuery.toLowerCase()
    return files.filter(f => f.name.toLowerCase().includes(q) || f.ext.includes(q))
  }, [files, searchQuery])

  const imageFiles = useMemo(() => filteredFiles.filter(f => f.type.startsWith('image/')), [filteredFiles])
  const docFiles = useMemo(() => filteredFiles.filter(f => !f.type.startsWith('image/')), [filteredFiles])

  const isImage = (f: UploadedFile) => f.type.startsWith('image/')

  const handlePreview = (f: UploadedFile, idx: number) => {
    setPreviewFile(f)
    setPreviewIndex(idx)
  }

  const handleClosePreview = () => {
    setPreviewFile(null)
    setPreviewIndex(-1)
  }

  const handlePrev = () => {
    if (previewIndex > 0) {
      const newIdx = previewIndex - 1
      setPreviewFile(filteredFiles[newIdx])
      setPreviewIndex(newIdx)
    }
  }

  const handleNext = () => {
    if (previewIndex < filteredFiles.length - 1) {
      const newIdx = previewIndex + 1
      setPreviewFile(filteredFiles[newIdx])
      setPreviewIndex(newIdx)
    }
  }

  const navigateTo = (view: 'chat' | 'image-studio' | 'files') => {
    setCurrentView(view)
    navigate(getPathnameForView(view))
  }

  const handleAttachToChat = async (f: UploadedFile) => {
    if (!currentSessionId) return
    setAttaching(true)
    try {
      const attachment: {
        id: string
        type: 'image' | 'file'
        url: string
        name: string
        mimeType: string
      } = {
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: isImage(f) ? 'image' : 'file',
        url: f.path,
        name: f.name,
        mimeType: f.type,
      }

      const msgId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
      await useChatStore.getState().addMessage(currentSessionId, {
        id: msgId,
        role: 'user',
        content: isImage(f) ? '' : `[Attached: ${f.name}]`,
        attachments: [attachment],
        timestamp: Date.now(),
      })

      navigateTo('chat')
    } catch (err) {
      console.error('Failed to attach file:', err)
    } finally {
      setAttaching(false)
    }
  }

  const handleEditInStudio = (f: UploadedFile) => {
    useImageStudioStore.getState().setPendingEditUrl(f.path)
    navigateTo('image-studio')
  }

  const handleFileClick = async (f: UploadedFile) => {
    // Toggle session panel for the clicked file
    if (selectedFile?.name === f.name) {
      setSelectedFile(null)
      setFileSessions({ loading: false, sessions: [], error: null })
      return
    }

    setSelectedFile(f)
    setFileSessions({ loading: true, sessions: [], error: null })

    try {
      const filename = encodeURIComponent(f.name)
      const res = await fetch(`/api/upload/${filename}/sessions`)
      const data = await res.json()
      if (res.ok) {
        setFileSessions({ loading: false, sessions: data.sessions || [], error: null })
      } else {
        setFileSessions({ loading: false, sessions: [], error: data.error || 'Failed to load sessions' })
      }
    } catch (err: any) {
      setFileSessions({ loading: false, sessions: [], error: err.message || 'Failed to load sessions' })
    }
  }

  const handleGoToSession = async (session: FileSession) => {
    await useChatStore.getState().setCurrentSession(session.id)
    navigateTo('chat')
  }

  const getFileIcon = (f: UploadedFile) => {
    if (f.type.startsWith('image/')) return <ImageIcon className="w-5 h-5" />
    if (f.type === 'text/markdown' || f.type === 'text/html') return <FileText className="w-5 h-5" />
    if (f.type === 'application/pdf') return <FileText className="w-5 h-5" />
    if (f.type === 'application/json') return <FileSpreadsheet className="w-5 h-5" />
    return <FileIcon className="w-5 h-5" />
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-display font-bold">Files</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {files.length} file{files.length !== 1 ? 's' : ''} uploaded
            </p>
          </div>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files..."
              className="w-56 pl-3 pr-3 py-1.5 bg-secondary border border-border rounded-sm text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredFiles.length === 0 ? (
          <div className="text-center py-16">
            <Upload className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? 'No files match your search.' : 'No uploaded files yet.'}
            </p>
            <p className="text-xs text-muted-foreground/50 mt-1">
              Upload files from the chat composer to see them here.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Images Section */}
            {imageFiles.length > 0 && (
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                  Images ({imageFiles.length})
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {imageFiles.map((f) => (
                    <div
                      key={f.name}
                      className="group relative border border-border rounded-sm overflow-hidden bg-card hover:border-accent/40 transition-colors cursor-pointer"
                      onClick={() => handleFileClick(f)}
                    >
                      <div className="aspect-square overflow-hidden bg-secondary/30">
                        <img
                          src={f.path}
                          alt={f.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          loading="lazy"
                        />
                      </div>
                      <div className="p-1.5">
                        <p className="text-[10px] truncate text-foreground">{f.name}</p>
                        <p className="text-[9px] text-muted-foreground">{formatFileSize(f.size)}</p>
                      </div>
                      {/* Hover actions */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePreview(f, filteredFiles.indexOf(f)) }}
                          className="p-1.5 bg-background/80 text-foreground rounded-sm hover:bg-background transition-colors"
                          title="Preview"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAttachToChat(f) }}
                          disabled={attaching}
                          className="p-1.5 bg-accent text-accent-foreground rounded-sm hover:bg-accent/90 transition-colors"
                          title="Attach to chat"
                        >
                          <Upload className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEditInStudio(f) }}
                          className="p-1.5 bg-accent text-accent-foreground rounded-sm hover:bg-accent/90 transition-colors"
                          title="Edit in Image Studio"
                        >
                          <PencilLine className="w-3.5 h-3.5" />
                        </button>
                        <a
                          href={f.path}
                          download
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 bg-background/80 text-foreground rounded-sm hover:bg-background transition-colors"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Documents Section */}
            {docFiles.length > 0 && (
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                  Documents ({docFiles.length})
                </h2>
                <div className="space-y-1">
                  {docFiles.map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center gap-3 px-3 py-2 border border-border rounded-sm hover:border-accent/30 hover:bg-secondary/30 transition-colors group cursor-pointer"
                      onClick={() => handleFileClick(f)}
                    >
                      <div className="p-1.5 bg-secondary/50 border border-border rounded-sm text-muted-foreground">
                        {getFileIcon(f)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{f.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(f.size)} &middot; {new Date(f.mtime).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePreview(f, filteredFiles.indexOf(f)) }}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
                          title="Preview"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAttachToChat(f) }}
                          disabled={attaching}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
                          title="Attach to chat"
                        >
                          <Upload className="w-3.5 h-3.5" />
                        </button>
                        {f.type.startsWith('image/') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditInStudio(f) }}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
                            title="Edit in Image Studio"
                          >
                            <PencilLine className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <a
                          href={f.path}
                          download
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* File Sessions Panel */}
      {selectedFile && (
        <div className="border-t border-border bg-card px-6 py-4 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium truncate">{selectedFile.name}</span>
              <span className="text-xs text-muted-foreground">in chats</span>
            </div>
            <button
              onClick={() => { setSelectedFile(null); setFileSessions({ loading: false, sessions: [], error: null }) }}
              className="p-1 text-muted-foreground hover:text-foreground rounded-sm hover:bg-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {fileSessions.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading...
            </div>
          ) : fileSessions.error ? (
            <p className="text-xs text-destructive">{fileSessions.error}</p>
          ) : fileSessions.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not used in any chat yet.</p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {fileSessions.sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleGoToSession(s)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-sm text-left hover:bg-secondary/50 transition-colors group"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate flex-1">{s.title}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(s.updatedAt).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    Go to chat →
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lightbox Preview */}
      {previewFile && isImage(previewFile) && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={handleClosePreview}
        >
          <button
            onClick={(e) => { e.stopPropagation(); handleClosePreview() }}
            className="absolute top-4 right-4 p-2 bg-black/40 text-white rounded-full hover:bg-black/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {previewIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); handlePrev() }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/40 text-white rounded-full hover:bg-black/60 transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {previewIndex < filteredFiles.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); handleNext() }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/40 text-white rounded-full hover:bg-black/60 transition-colors"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          <img
            src={previewFile.path}
            alt={previewFile.name}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-sm"
            onClick={(e) => e.stopPropagation()}
          />

          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-sm flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <span>{previewFile.name}</span>
            <span className="text-white/60">&middot;</span>
            <span>{formatFileSize(previewFile.size)}</span>
            <button
              onClick={() => handleEditInStudio(previewFile)}
              className="ml-1 px-2 py-0.5 bg-accent text-accent-foreground rounded-sm text-[10px] hover:bg-accent/90 transition-colors flex items-center gap-1"
            >
              <PencilLine className="w-3 h-3" />
              Edit
            </button>
            <button
              onClick={() => handleAttachToChat(previewFile)}
              disabled={attaching}
              className="ml-1 px-2 py-0.5 bg-accent text-accent-foreground rounded-sm text-[10px] hover:bg-accent/90 transition-colors"
            >
              {attaching ? '...' : 'Attach'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
