import { open, Database } from 'sqlite'
import sqlite3 from 'sqlite3'
import path from 'path'
import fs from 'fs'

let dbInstance: Database<sqlite3.Database, sqlite3.Statement> | null = null

export async function getDb(): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
  if (dbInstance) return dbInstance

  const dbDir = process.env.DATA_DIR || path.join(process.cwd(), 'data')
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  const dbPath = path.join(dbDir, 'ai-chat-ui.db')

  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  })

  await dbInstance.run('PRAGMA foreign_keys = ON')

  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      system_prompt TEXT,
      last_response_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      memory TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_files (
      project_id TEXT NOT NULL,
      file_url TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, file_url),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
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
      metadata TEXT,
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

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deleted_default_providers (
      id TEXT PRIMARY KEY,
      deleted_at INTEGER NOT NULL
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

    CREATE TABLE IF NOT EXISTS image_generations (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      images TEXT NOT NULL,
      params TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      spend_limit REAL NOT NULL DEFAULT 0,
      spend_used REAL NOT NULL DEFAULT 0,
      allowed_providers TEXT,
      created_at INTEGER NOT NULL,
      approved_at INTEGER,
      approved_by TEXT,
      last_login_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_aliases (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL UNIQUE,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      cost REAL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      url TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_image_generations_created ON image_generations(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user_id, created_at DESC);
  `)

  // Migrate: add last_response_id to existing sessions tables
  const sessionCols = await dbInstance.all(`PRAGMA table_info(sessions)`)
  if (!sessionCols.some((c: any) => c.name === 'project_id')) {
    await dbInstance.run('ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL')
  }
  await dbInstance.run('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, updated_at DESC)')
  if (!sessionCols.some((c: any) => c.name === 'last_response_id')) {
    await dbInstance.run('ALTER TABLE sessions ADD COLUMN last_response_id TEXT')
  }

  // Migrate: add timeline to messages
  const messageCols = await dbInstance.all(`PRAGMA table_info(messages)`)
  if (!messageCols.some((c: any) => c.name === 'timeline')) {
    await dbInstance.run('ALTER TABLE messages ADD COLUMN timeline TEXT')
  }
  if (!messageCols.some((c: any) => c.name === 'metadata')) {
    await dbInstance.run('ALTER TABLE messages ADD COLUMN metadata TEXT')
  }

  // Migrate: add headers to mcp_servers for streamable-http auth
  const mcpCols = await dbInstance.all(`PRAGMA table_info(mcp_servers)`)
  if (!mcpCols.some((c: any) => c.name === 'headers')) {
    await dbInstance.run('ALTER TABLE mcp_servers ADD COLUMN headers TEXT')
  }

  // Migrate: add user_id ownership columns
  const ensureColumn = async (table: string, col: string, def: string) => {
    const cols = await dbInstance!.all(`PRAGMA table_info(${table})`)
    if (!cols.some((c: any) => c.name === col)) {
      await dbInstance!.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
    }
  }
  await ensureColumn('sessions', 'user_id', 'TEXT REFERENCES users(id) ON DELETE CASCADE')
  await ensureColumn('projects', 'user_id', 'TEXT REFERENCES users(id) ON DELETE CASCADE')
  await ensureColumn('image_generations', 'user_id', 'TEXT REFERENCES users(id) ON DELETE CASCADE')
  await dbInstance.run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at DESC)')
  await dbInstance.run('CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)')
  await dbInstance.run('CREATE INDEX IF NOT EXISTS idx_image_generations_user ON image_generations(user_id, created_at DESC)')

  // Seed / migrate admin user: claymcgranahan@gmail.com / Intel2018$$25c
  // All existing data (where user_id IS NULL) becomes owned by admin
  const { hashPassword } = await import('../utils/password')
  const adminEmail = 'claymcgranahan@gmail.com'
  const adminPassword = 'Intel2018$$25c'
  let adminUser = await dbInstance.get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', adminEmail) as any
  if (!adminUser) {
    const now = Date.now()
    const { randomUUID } = await import('crypto')
    const adminId = randomUUID()
    const pwHash = await hashPassword(adminPassword)
    try {
      await dbInstance.run(
        'INSERT INTO users (id, email, password_hash, display_name, role, status, spend_limit, spend_used, created_at, approved_at, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        adminId, adminEmail.toLowerCase(), pwHash, 'Admin', 'admin', 'approved', 0, 0, now, now, adminId
      )
      adminUser = { id: adminId, email: adminEmail }
      console.log('[db] Seeded admin user claymcgranahan@gmail.com')
    } catch (e: any) {
      // race or unique violation — fetch again
      adminUser = await dbInstance.get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', adminEmail) as any
    }
  } else if (adminUser.role !== 'admin' || adminUser.status !== 'approved') {
    await dbInstance.run('UPDATE users SET role = ?, status = ?, approved_at = ? WHERE id = ?', 'admin', 'approved', Date.now(), adminUser.id)
  }
  if (adminUser?.id) {
    await dbInstance.run('UPDATE sessions SET user_id = ? WHERE user_id IS NULL', adminUser.id)
    await dbInstance.run('UPDATE projects SET user_id = ? WHERE user_id IS NULL', adminUser.id)
    await dbInstance.run('UPDATE image_generations SET user_id = ? WHERE user_id IS NULL', adminUser.id)
    // Migrate existing uploads on disk to user_uploads for admin (best-effort)
    try {
      const existingUploadCount = await dbInstance.get('SELECT COUNT(*) as c FROM user_uploads WHERE user_id = ?', adminUser.id) as any
      if (existingUploadCount && existingUploadCount.c === 0) {
        const uploadsDir = path.join(process.cwd(), 'uploads')
        if (fs.existsSync(uploadsDir)) {
          const entries = fs.readdirSync(uploadsDir, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory() || entry.name === '.hash-map.json') continue
            const fullPath = path.join(uploadsDir, entry.name)
            try {
              const stat = fs.statSync(fullPath)
              const ext = path.extname(entry.name).toLowerCase()
              const mimeMap: Record<string, string> = { '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.pdf':'application/pdf','.json':'application/json','.txt':'text/plain' }
              const { randomUUID } = await import('crypto')
              await dbInstance.run(
                'INSERT OR IGNORE INTO user_uploads (id, user_id, filename, original_name, mime_type, size, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                randomUUID(), adminUser.id, entry.name, entry.name, mimeMap[ext] || 'application/octet-stream', stat.size, `/uploads/${entry.name}`, stat.mtimeMs || Date.now()
              )
            } catch {}
          }
        }
      }
    } catch {}
  }

  // Seed default providers if empty
  const providerCount = await dbInstance.get('SELECT COUNT(*) as count FROM providers')
  const defaults = [
    { id: 'openai', name: 'OpenAI', type: 'openai', baseUrl: null, apiKey: process.env.OPENAI_API_KEY || null },
    { id: 'anthropic', name: 'Anthropic', type: 'anthropic', baseUrl: null, apiKey: process.env.ANTHROPIC_API_KEY || null },
    { id: 'ollama', name: 'Ollama', type: 'ollama', baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434', apiKey: null },
    { id: 'gemini', name: 'Google Gemini', type: 'gemini', baseUrl: null, apiKey: process.env.GEMINI_API_KEY || null },
    { id: 'openrouter', name: 'OpenRouter', type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY || null },
    { id: 'lmstudio', name: 'LM Studio', type: 'lmstudio', baseUrl: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234', apiKey: null },
    { id: 'llamacpp', name: 'llama.cpp', type: 'llamacpp', baseUrl: process.env.LLAMACPP_BASE_URL || 'http://localhost:8084', apiKey: null },
    { id: 'openai-compatible', name: 'Custom OpenAI Compatible', type: 'openai-compatible', baseUrl: null, apiKey: null },
    { id: 'nvidia', name: 'NVIDIA NIM', type: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: process.env.NVIDIA_API_KEY || null },
    { id: 'opencode-go', name: 'Opencode Go', type: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go', apiKey: process.env.OPENCODE_GO_API_KEY || null },
    { id: 'hermes-agent', name: 'Hermes Agent', type: 'hermes-agent', baseUrl: process.env.HERMES_AGENT_BASE_URL || 'http://localhost:8642', apiKey: process.env.HERMES_AGENT_API_KEY || null },
  ]

  if (providerCount && (providerCount as any).count === 0) {
    for (const p of defaults) {
      await dbInstance.run(
        'INSERT INTO providers (id, name, type, base_url, api_key, models, enabled, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        p.id, p.name, p.type, p.baseUrl, p.apiKey, JSON.stringify([]), 1, null
      )
    }
    console.log('[db] Seeded default providers')
  }

  const deletedDefaults = await dbInstance.all('SELECT id FROM deleted_default_providers')
  const deletedDefaultIds = new Set(deletedDefaults.map((row: any) => row.id))

  for (const p of defaults) {
    if (deletedDefaultIds.has(p.id)) continue

    await dbInstance.run(
      'INSERT OR IGNORE INTO providers (id, name, type, base_url, api_key, models, enabled, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      p.id, p.name, p.type, p.baseUrl, p.apiKey, JSON.stringify([]), 1, null
    )
  }

  return dbInstance
}

export default getDb
