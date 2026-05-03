# AI Chat UI Browser Extension

This Chromium extension lets the frontend import an open browser tab as chat context.

## Install

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this `browser-extension` folder.

## Development URLs

The extension currently injects into:

- `http://localhost:5183/*`
- `http://127.0.0.1:5183/*`

If you deploy the app somewhere else, add that origin to `manifest.json` under `content_scripts.matches`.

## How it works

- The frontend posts a request message.
- The content script forwards it to the extension service worker.
- The service worker lists tabs or captures the selected tab's text.
- The frontend sends that snapshot to `/api/upload/browser-tab` and reuses the normal attachment flow.