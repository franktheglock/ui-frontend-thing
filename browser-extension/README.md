# AI Chat UI Browser Extension

This Chromium extension lets the frontend import an open browser tab as chat context.

## Install

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this `browser-extension` folder.

## Development URLs

The extension activates automatically on local Vite app tabs running on port `5183`, including:

- `http://localhost:5183/*`
- `http://127.0.0.1:5183/*`
- local network IPs like `http://192.168.x.x:5183/*`
- other private LAN ranges like `10.x.x.x` and `172.16.x.x` through `172.31.x.x`

After changing the extension files, click **Reload** on the extension in `chrome://extensions` or `edge://extensions`, then refresh the app tab.

## How it works

- The frontend posts a request message.
- The content script forwards it to the extension service worker.
- The service worker lists tabs or captures the selected tab's text.
- The frontend sends that snapshot to `/api/upload/browser-tab` and reuses the normal attachment flow.