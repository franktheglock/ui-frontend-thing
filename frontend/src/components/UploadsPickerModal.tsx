import { useEffect, useMemo, useState } from 'react'
import { X, Search, FileIcon, FileText, Loader2, Check } from 'lucide-react'
import { cn, formatFileSize } from '../lib/utils'

interface UploadedFile {
  name: string
  path: string
  size: number
  mtime: string
  type: string
  ext: string
}

interface UploadsPickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (files: { name: string; path: string; mimeType: string }[]) => void
}

export function UploadsPickerModal({ open, onClose, onSelect }: UploadsPickerModalProps) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setSelected(new Set())
    fetch('/api/upload/list')
      .then(r => r.json())
      .then(data => {
        setFiles(Array.isArray(data.files) ? data.files : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [open])

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files
    const q = searchQuery.toLowerCase()
    return files.filter(f => f.name.toLowerCase().includes(q) || f.ext.includes(q))
  }, [files, searchQuery])

  const toggleFile = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleConfirm = () => {
    const chosen = files.filter(f => selected.has(f.path))
    onSelect(chosen.map(f => ({ name: f.name, path: f.path, mimeType: f.type })))
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-bold">Select Uploaded Files</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-border/60">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files..."
              className="w-full pl-8 pr-3 py-1.5 bg-secondary border border-border rounded-sm text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {searchQuery ? 'No files match.' : 'No uploaded files.'}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredFiles.map((f) => {
                const isSelected = selected.has(f.path)
                const isImage = f.type.startsWith('image/')
                return (
                  <button
                    key={f.path}
                    onClick={() => toggleFile(f.path)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-sm text-left transition-colors',
                      isSelected
                        ? 'bg-accent/10 border border-accent/30'
                        : 'hover:bg-secondary/50 border border-transparent'
                    )}
                  >
                    <div className="w-8 h-8 flex-shrink-0 rounded-sm overflow-hidden bg-secondary/50 border border-border flex items-center justify-center">
                      {isImage ? (
                        <img src={f.path} alt="" className="w-full h-full object-cover" />
                      ) : f.type === 'text/markdown' || f.type === 'text/html' ? (
                        <FileText className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <FileIcon className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{f.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(f.size)}</p>
                    </div>
                    <div className={cn(
                      'w-5 h-5 rounded-sm border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                      isSelected ? 'bg-accent border-accent' : 'border-border'
                    )}>
                      {isSelected && <Check className="w-3 h-3 text-accent-foreground" />}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {selected.size} file{selected.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selected.size === 0}
              className={cn(
                'px-3 py-1.5 text-sm rounded-sm transition-colors',
                selected.size > 0
                  ? 'bg-accent text-accent-foreground hover:bg-accent/90'
                  : 'bg-secondary text-muted-foreground cursor-not-allowed'
              )}
            >
              Attach
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
