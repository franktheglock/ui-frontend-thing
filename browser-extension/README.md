# AI Chat New Tab

Replaces the browser's new tab page with the AI Chat UI.  
Press **Tab** to toggle between chat mode and web search.

## Features

- **AI Chat** — full AI Chat UI as your new tab page (sidebar, messages, model selector, everything)
- **Tab to Search** — press Tab and the input switches to search mode; Enter opens a web search (DuckDuckGo, Google, or Brave)
- **Inline Shortcuts** — favicon bookmarks shown on the landing page when you open a new tab (stored in localStorage, configurable)

## Installation

1. Download the zip from `http://192.168.1.129:9199/` and unzip it
2. **First time only:** visit `https://192.168.1.129:5184` and click **Advanced → Proceed** to accept the self-signed certificate
3. Open `chrome://extensions`, enable **Developer mode**
4. Click **Load unpacked** and select the unzipped folder
5. Open a new tab → it's now your AI Chat UI

## How it works

The extension uses `chrome_url_overrides.newtab` to load the AI Chat UI in a fullscreen iframe. The AI Chat frontend itself has been modified to support Tab-mode switching and inline shortcuts. No extension chrome, no separate tab bar — the page IS the AI Chat UI.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (v3) |
| `newtab.html` | Thin new tab page — just an iframe |
| `options.html` / `options.js` | Settings page (AI Chat URL) |
| `icons/` | Extension icons |

## Development

After modifying the AI Chat frontend, rebuild with `npm run build` in the frontend/ directory. The Express server serves the updated files on port 5183, and the HTTPS proxy on 5184 passes them through.

Reload the extension at `chrome://extensions` to pick up manifest changes.
