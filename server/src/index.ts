import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import chatRoutes from './api/chat'
import providerRoutes from './api/providers'
import toolRoutes from './api/tools'
import uploadRoutes from './api/upload'
import skillRoutes from './api/skills'
import mcpRoutes from './api/mcp'
import { getDb } from './db'
import { mcpManager } from './mcp/mcp-manager'

dotenv.config()

async function main() {
  // Initialize database
  await getDb()

  const app = express()
  const PORT = process.env.PORT || 3456

  app.use(cors())
  app.use(express.json({ limit: '50mb' }))
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

  app.use('/api/chat', chatRoutes)
  app.use('/api/providers', providerRoutes)
  app.use('/api/tools', toolRoutes)
  app.use('/api/upload', uploadRoutes)
  app.use('/api/skills', skillRoutes)
  app.use('/api/mcp', mcpRoutes)

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' })
  })

  // Serve static frontend in production
  const frontendDist = path.join(process.cwd(), '..', 'frontend', 'dist')
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'))
    })
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`[server] Running on port ${PORT}`)
    // Initialize MCP servers after server is ready
    try {
      await mcpManager.loadFromDb()
    } catch (err: any) {
      console.error('[mcp] Failed to initialize:', err.message)
    }
  })
}

main().catch(err => {
  console.error('[server] Failed to start:', err)
  process.exit(1)
})
