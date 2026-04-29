# AI Chat UI — Agent Context

## Project Overview

AI Chat UI is a full-stack chat interface for LLMs with multi-provider support, extensible tools, and a skills system.

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + Zustand + Framer Motion
- **Backend**: Express + TypeScript + SQLite (better-sqlite3 via `sqlite` wrapper)
- **Build**: `tsc` for server, `vite build` for frontend
- **Dev**: `tsx watch` for server, `vite` for frontend, `concurrently` to run both

## Directory Structure

```
/
├── frontend/          # React SPA
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── stores/        # Zustand stores (chat, settings, UI)
│   │   ├── hooks/         # Custom hooks (useChat)
│   │   ├── lib/           # Utilities
│   │   └── styles/        # Tailwind + global CSS
│   └── package.json
├── server/            # Express API
│   ├── src/
│   │   ├── api/           # Route handlers (chat, providers, skills, tools, upload)
│   │   ├── providers/     # LLM provider implementations
│   │   ├── tools/         # Tool implementations
│   │   ├── db/            # SQLite schema and connection
│   │   ├── mcp/           # MCP (Model Context Protocol) manager
│   │   └── types/         # Shared TypeScript types
│   └── package.json
├── skills/            # User-installed skills (SKILL.md files)
│   └── make-skill/        # Built-in skill authoring guide
├── .env.example       # Template for environment variables
├── docker-compose.yml
└── package.json       # Root with concurrent dev scripts
```

## Key Conventions

### Frontend
- Use functional components with hooks
- State management via Zustand stores
- UI components use `cn()` from `lib/utils` for conditional classes
- Tailwind for styling; custom CSS vars for theming in `styles/index.css`
- Icons from `lucide-react`

### Backend
- Providers extend `BaseProvider` and implement `chatCompletion()`
- Tools extend `BaseTool` and implement `execute()`
- All routes under `/api/*`
- SQLite for persistence; migrations in `db/index.ts`
- Streaming via SSE (`text/event-stream`)

### Environment Variables
- `.env` at project root (never commit)
- Server reads via `dotenv`
- Frontend has no env vars; talks to same-origin `/api/*`

## Development

```bash
# Install everything
npm run setup

# Run both frontend and server
npm run dev

# Frontend only
npm run dev:frontend

# Server only
npm run dev:server
```

## Database Schema

Key tables:
- `sessions` — chat sessions with metadata
- `messages` — chat messages (content, thinking, toolCalls, toolResults)
- `providers` — configured LLM providers
- `skills` — installed skills

## Important Notes

- **Never commit `.env`** — it contains API keys
- **Never commit `node_modules/` or build outputs**
- The `skills/` directory is in `.gitignore` except for `skills/make-skill/`
- Python tool creates a `.venv` in the working directory on first use
- The server uses `crypto.randomUUID()` with a polyfill fallback for HTTP contexts

## Testing Changes

After modifying server code, the `tsx watch` dev server auto-reloads.
After modifying frontend code, Vite HMR handles updates.
Both are started together via `npm run dev`.
