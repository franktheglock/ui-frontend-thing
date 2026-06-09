import { create } from 'zustand'

export interface Project {
  id: string
  name: string
  description: string
  memory: string
  createdAt: number
  updatedAt: number
  chatCount: number
  fileCount: number
}

export interface ProjectFile {
  projectId: string
  url: string
  name: string
  mimeType: string
  createdAt: number
}

interface ProjectState {
  projects: Project[]
  currentProjectId: string | null
  projectFiles: Record<string, ProjectFile[]>
  loading: boolean

  loadProjects: () => Promise<void>
  createProject: (name?: string) => Promise<string>
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'memory'>>) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setCurrentProject: (id: string | null) => void
  loadProjectFiles: (projectId: string) => Promise<void>
  addFilesToProject: (projectId: string, files: { url?: string; path?: string; name: string; mimeType: string }[]) => Promise<void>
  removeFileFromProject: (projectId: string, url: string) => Promise<void>
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projects: [],
  currentProjectId: null,
  projectFiles: {},
  loading: false,

  loadProjects: async () => {
    set({ loading: true })
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) return
      const projects = await res.json()
      if (Array.isArray(projects)) set({ projects })
    } catch (err) {
      console.error('[projectStore] Failed to load projects:', err)
    } finally {
      set({ loading: false })
    }
  },

  createProject: async (name) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || 'New Project' }),
    })
    if (!res.ok) throw new Error('Failed to create project')
    const project = await res.json()
    set(state => ({
      projects: [project, ...state.projects],
      currentProjectId: project.id,
    }))
    return project.id
  },

  updateProject: async (id, updates) => {
    set(state => ({
      projects: state.projects.map(p =>
        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
      ),
    }))
    try {
      await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
    } catch (err) {
      console.error('[projectStore] Failed to update project:', err)
    }
  },

  deleteProject: async (id) => {
    set(state => ({
      projects: state.projects.filter(p => p.id !== id),
      currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
    }))
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    } catch (err) {
      console.error('[projectStore] Failed to delete project:', err)
    }
  },

  setCurrentProject: (id) => set({ currentProjectId: id }),

  loadProjectFiles: async (projectId) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/files`)
      if (!res.ok) return
      const files = await res.json()
      set(state => ({
        projectFiles: {
          ...state.projectFiles,
          [projectId]: Array.isArray(files) ? files : [],
        },
      }))
    } catch (err) {
      console.error('[projectStore] Failed to load project files:', err)
    }
  },

  addFilesToProject: async (projectId, files) => {
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    })
    if (!res.ok) throw new Error('Failed to add project files')
    const projectFiles = await res.json()
    set(state => ({
      projects: state.projects.map(p =>
        p.id === projectId ? { ...p, fileCount: Array.isArray(projectFiles) ? projectFiles.length : p.fileCount } : p
      ),
      projectFiles: {
        ...state.projectFiles,
        [projectId]: Array.isArray(projectFiles) ? projectFiles : [],
      },
    }))
  },

  removeFileFromProject: async (projectId, url) => {
    set(state => ({
      projectFiles: {
        ...state.projectFiles,
        [projectId]: (state.projectFiles[projectId] || []).filter(file => file.url !== url),
      },
    }))
    try {
      await fetch(`/api/projects/${projectId}/files`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      await get().loadProjects()
    } catch (err) {
      console.error('[projectStore] Failed to remove project file:', err)
    }
  },
}))
