import { open, Database } from 'sqlite'
import sqlite3 from 'sqlite3'
import path from 'path'
import fs from 'fs'

const DB_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true })
}

const DB_PATH = path.join(DB_DIR, 'ai-chat-ui.db')

let dbInstance: Database<sqlite3.Database, sqlite3.Statement> | null = null

export async function getDb(): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
  if (dbInstance) return dbInstance

  dbInstance = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  })

  await dbInstance.run('PRAGMA foreign_keys = ON')

  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      system_prompt TEXT,
      last_response_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      thinking TEXT,
      tool_calls TEXT,
      tool_results TEXT,
      attachments TEXT,
      generation_info TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT,
      api_key TEXT,
      models TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT
    );

    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      schema TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      source TEXT NOT NULL,
      manifest TEXT NOT NULL,
      installed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      command TEXT,
      args TEXT,
      url TEXT,
      env TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_connect INTEGER NOT NULL DEFAULT 1
    );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
  `)

  // Migrate: add last_response_id to existing sessions tables
  const sessionCols = await dbInstance.all(`PRAGMA table_info(sessions)`)
  if (!sessionCols.some((c: any) => c.name === 'last_response_id')) {
    await dbInstance.run('ALTER TABLE sessions ADD COLUMN last_response_id TEXT')
  }

  // Seed default providers if empty
  const providerCount = await dbInstance.get('SELECT COUNT(*) as count FROM providers')
  if (providerCount && (providerCount as any).count === 0) {
    const defaults = [
      { id: 'openai', name: 'OpenAI', type: 'openai', baseUrl: null, apiKey: process.env.OPENAI_API_KEY || null },
      { id: 'anthropic', name: 'Anthropic', type: 'anthropic', baseUrl: null, apiKey: process.env.ANTHROPIC_API_KEY || null },
      { id: 'ollama', name: 'Ollama', type: 'ollama', baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434', apiKey: null },
      { id: 'gemini', name: 'Google Gemini', type: 'gemini', baseUrl: null, apiKey: process.env.GEMINI_API_KEY || null },
      { id: 'openrouter', name: 'OpenRouter', type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY || null },
      { id: 'lmstudio', name: 'LM Studio', type: 'lmstudio', baseUrl: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234', apiKey: null },
      { id: 'nvidia', name: 'NVIDIA NIM', type: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: process.env.NVIDIA_API_KEY || null },
    ]

    for (const p of defaults) {
      await dbInstance.run(
        'INSERT INTO providers (id, name, type, base_url, api_key, models, enabled, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        p.id, p.name, p.type, p.baseUrl, p.apiKey, JSON.stringify([]), 1, null
      )
    }
    console.log('[db] Seeded default providers')
  }

  return dbInstance
}

export default getDb
