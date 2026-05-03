import { useState, useMemo, memo, useEffect } from 'react'
import { X, Check, Plus, Trash2, ChevronDown, ChevronRight, Search, Pencil } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useChatStore } from '../stores/chatStore'
import { cn } from '../lib/utils'
import { getProviderIcon } from '../lib/providerIcons'

function modelsToText(models: string[] | undefined) {
  return (models || []).join(', ')
}

const ProviderSection = memo(function ProviderSection({
  provider,
  selectedModel,
  selectedProvider,
  onSelect,
  onUpdate,
  onRemove,
  searchQuery,
  isOpen,
  onToggle,
}: {
  provider: any
  selectedModel: string
  selectedProvider: string
  onSelect: (providerId: string, model: string) => void
  onUpdate: (id: string, updates: any) => void
  onRemove: (id: string) => void
  searchQuery: string
  isOpen: boolean
  onToggle: () => void
}) {
  const ProviderIcon = getProviderIcon(provider.id)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState({
    name: provider.name || '',
    baseUrl: provider.baseUrl || provider.base_url || '',
    apiKey: provider.apiKey || provider.api_key || '',
    models: modelsToText(provider.models),
  })

  useEffect(() => {
    if (!isEditing) {
      setDraft({
        name: provider.name || '',
        baseUrl: provider.baseUrl || provider.base_url || '',
        apiKey: provider.apiKey || provider.api_key || '',
        models: modelsToText(provider.models),
      })
    }
  }, [provider, isEditing])

  const filteredModels = useMemo(() => {
    const models = Array.from(new Set(provider.models || [])) as string[]
    if (!searchQuery.trim()) return models
    const q = searchQuery.toLowerCase()
    return models.filter((m: string) => m.toLowerCase().includes(q))
  }, [provider.models, searchQuery])

  if (filteredModels.length === 0 && searchQuery.trim()) return null

  const isSelectedProvider = selectedProvider === provider.id
  
  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <div
        className="w-full flex items-center justify-between px-3 py-2.5 bg-secondary/50 transition-colors"
      >
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 text-left"
        >
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <ProviderIcon size={15} className="flex-shrink-0 opacity-80" />
          <h3 className="text-xs font-medium uppercase tracking-wider text-foreground">
            {provider.name}
          </h3>
          <span className="text-xs text-muted-foreground">
            {filteredModels.length}
          </span>
          {isSelectedProvider && (
            <span className="text-[10px] px-1.5 py-0.5 bg-accent/10 text-accent rounded-sm">active</span>
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setIsEditing((prev) => !prev)
          }}
          className="p-1 hover:bg-accent/10 hover:text-accent rounded-sm transition-colors"
          title="Edit provider"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove(provider.id)
          }}
          className="p-1 hover:bg-destructive/10 hover:text-destructive rounded-sm transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {isOpen && (
        <div className="p-2 grid grid-cols-1 gap-1">
          {isEditing && (
            <div className="mb-2 space-y-2 border border-border rounded-sm p-3 bg-secondary/30">
              <div className="flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground">
                <ProviderIcon size={14} className="flex-shrink-0 opacity-80" />
                <span>Editing {provider.name}</span>
              </div>
              <input
                type="text"
                placeholder="Name"
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="text"
                placeholder="Base URL (optional)"
                value={draft.baseUrl}
                onChange={(e) => setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="password"
                placeholder="API Key (optional)"
                value={draft.apiKey}
                onChange={(e) => setDraft((prev) => ({ ...prev, apiKey: e.target.value }))}
                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="text"
                placeholder="Models (comma-separated)"
                value={draft.models}
                onChange={(e) => setDraft((prev) => ({ ...prev, models: e.target.value }))}
                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onUpdate(provider.id, {
                      name: draft.name || provider.name,
                      baseUrl: draft.baseUrl,
                      apiKey: draft.apiKey,
                      models: draft.models.split(',').map((model: string) => model.trim()).filter(Boolean),
                    })
                    setIsEditing(false)
                  }}
                  className="flex-1 px-3 py-2 bg-accent text-accent-foreground rounded-sm text-sm hover:bg-accent/90 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setDraft({
                      name: provider.name || '',
                      baseUrl: provider.baseUrl || provider.base_url || '',
                      apiKey: provider.apiKey || provider.api_key || '',
                      models: modelsToText(provider.models),
                    })
                    setIsEditing(false)
                  }}
                  className="px-3 py-2 border border-border rounded-sm text-sm hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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
              {isSelectedProvider && selectedModel === model ? (
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
              ) : (() => {
                const Icon = getProviderIcon(`${provider.id}/${model}`)
                return <Icon size={14} className="flex-shrink-0 opacity-60" />
              })()}
              <span className="truncate font-mono flex-1">{model}</span>
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
    updateProvider,
    removeProvider,
  } = useSettingsStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [openProviders, setOpenProviders] = useState<Set<string>>(new Set())
  const [newProviderOpen, setNewProviderOpen] = useState(false)
  const [isProbingProvider, setIsProbingProvider] = useState(false)
  const [probeResult, setProbeResult] = useState<string | null>(null)
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
    
    // Also update the current session if we have one
    const { currentSessionId, updateSessionModel } = useChatStore.getState()
    if (currentSessionId) {
      updateSessionModel(currentSessionId, model, providerId)
      // Sync to server
      fetch(`/api/chat/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, provider: providerId }),
      }).catch(err => console.error('Failed to sync session model switch:', err))
    }

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
      setProbeResult(null)
      setNewProvider({ id: '', name: '', type: 'openai', baseUrl: '', apiKey: '', models: '' })
    }
  }

  const handleProbeProvider = async () => {
    setIsProbingProvider(true)
    setProbeResult(null)
    try {
      const response = await fetch('/api/providers/probe-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newProvider.type,
          baseUrl: newProvider.baseUrl,
          apiKey: newProvider.apiKey,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setProbeResult(data.error || 'Probe failed')
        return
      }

      const models = Array.isArray(data.models) ? data.models : []
      setNewProvider((prev) => ({
        ...prev,
        models: models.join(', '),
      }))
      setProbeResult(models.length > 0 ? `Found ${models.length} model${models.length === 1 ? '' : 's'}` : 'Connected, but no models were returned')
    } catch (error: any) {
      setProbeResult(error.message || 'Probe failed')
    } finally {
      setIsProbingProvider(false)
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
            {(() => {
              const ProviderIcon = getProviderIcon(selectedProvider)
              return <ProviderIcon size={18} />
            })()}
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
              onUpdate={updateProvider}
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
                <option value="opencode-go">Opencode Go</option>
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
              <div className="flex gap-2">
                <button
                  onClick={handleProbeProvider}
                  disabled={isProbingProvider}
                  className="flex-1 px-3 py-2 border border-border rounded-sm text-sm hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {isProbingProvider ? 'Testing...' : 'Test Models Endpoint'}
                </button>
                <button
                  onClick={handleAddProvider}
                  className="flex-1 px-3 py-2 bg-accent text-accent-foreground rounded-sm text-sm hover:bg-accent/90 transition-colors"
                >
                  Add Provider
                </button>
              </div>
              {probeResult && (
                <p className="text-xs text-muted-foreground px-1">{probeResult}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
