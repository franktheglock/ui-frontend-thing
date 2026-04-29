import React, { useState, useMemo, memo } from 'react'
import { X, Cpu, Check, Plus, Trash2, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { cn } from '../lib/utils'

const ProviderSection = memo(function ProviderSection({
  provider,
  selectedModel,
  selectedProvider,
  onSelect,
  onRemove,
  searchQuery,
  isOpen,
  onToggle,
}: {
  provider: any
  selectedModel: string
  selectedProvider: string
  onSelect: (providerId: string, model: string) => void
  onRemove: (id: string) => void
  searchQuery: string
  isOpen: boolean
  onToggle: () => void
}) {
  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return provider.models || []
    const q = searchQuery.toLowerCase()
    return (provider.models || []).filter((m: string) => m.toLowerCase().includes(q))
  }, [provider.models, searchQuery])

  if (filteredModels.length === 0 && searchQuery.trim()) return null

  const isSelectedProvider = selectedProvider === provider.id

  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-secondary/50 hover:bg-secondary transition-colors"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <h3 className="text-xs font-medium uppercase tracking-wider text-foreground">
            {provider.name}
          </h3>
          <span className="text-xs text-muted-foreground">
            {(provider.models || []).length}
          </span>
          {isSelectedProvider && (
            <span className="text-[10px] px-1.5 py-0.5 bg-accent/10 text-accent rounded-sm">active</span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove(provider.id)
          }}
          className="p-1 hover:bg-destructive/10 hover:text-destructive rounded-sm transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </button>

      {isOpen && (
        <div className="p-2 grid grid-cols-1 gap-1">
          {filteredModels.map((model: string) => (
            <button
              key={model}
              onClick={() => onSelect(provider.id, model)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm rounded-sm border transition-colors text-left',
                isSelectedProvider && selectedModel === model
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-transparent hover:bg-secondary hover:border-border'
              )}
            >
              {isSelectedProvider && selectedModel === model && (
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
              )}
              <span className="truncate font-mono">{model}</span>
            </button>
          ))}
          {filteredModels.length === 0 && !searchQuery.trim() && (
            <p className="text-xs text-muted-foreground px-3 py-2 italic">No models found</p>
          )}
        </div>
      )}
    </div>
  )
})

export function ModelSelector() {
  const { modelSelectorOpen, setModelSelectorOpen } = useUIStore()
  const {
    providers,
    selectedModel,
    selectedProvider,
    setSelectedModel,
    setSelectedProvider,
    addProvider,
    removeProvider,
  } = useSettingsStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [openProviders, setOpenProviders] = useState<Set<string>>(new Set())
  const [newProviderOpen, setNewProviderOpen] = useState(false)
  const [newProvider, setNewProvider] = useState({
    id: '',
    name: '',
    type: 'openai',
    baseUrl: '',
    apiKey: '',
    models: '',
  })

  const toggleProvider = (id: string) => {
    setOpenProviders(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSelect = (providerId: string, model: string) => {
    setSelectedProvider(providerId)
    setSelectedModel(model)
    setModelSelectorOpen(false)
    setSearchQuery('')
  }

  const handleAddProvider = () => {
    if (newProvider.id && newProvider.name) {
      addProvider({
        id: newProvider.id,
        name: newProvider.name,
        type: newProvider.type as any,
        baseUrl: newProvider.baseUrl,
        apiKey: newProvider.apiKey,
        models: newProvider.models.split(',').map((m) => m.trim()).filter(Boolean),
        enabled: true,
      })
      setNewProviderOpen(false)
      setNewProvider({ id: '', name: '', type: 'openai', baseUrl: '', apiKey: '', models: '' })
    }
  }

  const enabledProviders = useMemo(() => providers.filter((p) => p.enabled), [providers])

  // Auto-expand the currently selected provider
  useMemo(() => {
    if (selectedProvider && !openProviders.has(selectedProvider)) {
      setOpenProviders(prev => new Set(prev).add(selectedProvider))
    }
  }, [selectedProvider])

  if (!modelSelectorOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => {
        setModelSelectorOpen(false)
        setSearchQuery('')
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-sm w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-medium">Select Model</h2>
          </div>
          <button
            onClick={() => {
              setModelSelectorOpen(false)
              setSearchQuery('')
            }}
            className="p-1.5 hover:bg-secondary rounded-sm transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-secondary border border-border rounded-sm text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {enabledProviders.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No providers configured. Add one below.
            </p>
          )}

          {enabledProviders.map((provider) => (
            <ProviderSection
              key={provider.id}
              provider={provider}
              selectedModel={selectedModel}
              selectedProvider={selectedProvider}
              onSelect={handleSelect}
              onRemove={removeProvider}
              searchQuery={searchQuery}
              isOpen={openProviders.has(provider.id) || !!searchQuery.trim()}
              onToggle={() => toggleProvider(provider.id)}
            />
          ))}

          <button
            onClick={() => setNewProviderOpen(!newProviderOpen)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-border rounded-sm text-sm text-muted-foreground hover:border-accent hover:text-accent transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Provider
          </button>

          {newProviderOpen && (
            <div className="space-y-3 border border-border rounded-sm p-3 animate-in fade-in slide-in-from-top-2 duration-150">
              <input
                type="text"
                placeholder="Provider ID (e.g., my-openai)"
                value={newProvider.id}
                onChange={(e) =>
                  setNewProvider({ ...newProvider, id: e.target.value })
                }
                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="text"
                placeholder="Name"
                value={newProvider.name}
                onChange={(e) =>
                  setNewProvider({ ...newProvider, name: e.target.value })
                }
                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <select
                value={newProvider.type}
                onChange={(e) =>
                  setNewProvider({ ...newProvider, type: e.target.value })
                }
                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="ollama">Ollama</option>
                <option value="openrouter">OpenRouter</option>
                <option value="lmstudio">LM Studio</option>
                <option value="nvidia">NVIDIA NIM</option>
                <option value="openai-compatible">OpenAI Compatible</option>
              </select>
              <input
                type="text"
                placeholder="Base URL (optional)"
                value={newProvider.baseUrl}
                onChange={(e) =>
                  setNewProvider({ ...newProvider, baseUrl: e.target.value })
                }
                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="password"
                placeholder="API Key (optional)"
                value={newProvider.apiKey}
                onChange={(e) =>
                  setNewProvider({ ...newProvider, apiKey: e.target.value })
                }
                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="text"
                placeholder="Models (comma-separated)"
                value={newProvider.models}
                onChange={(e) =>
                  setNewProvider({ ...newProvider, models: e.target.value })
                }
                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={handleAddProvider}
                className="w-full px-3 py-2 bg-accent text-accent-foreground rounded-sm text-sm hover:bg-accent/90 transition-colors"
              >
                Add Provider
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
