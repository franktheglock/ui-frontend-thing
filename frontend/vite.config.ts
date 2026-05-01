import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5183,
    host: '0.0.0.0',
    cors: true,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3456',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3456',
        changeOrigin: true,
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'framer-motion': ['framer-motion'],
          'markdown': ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex'],
          'ui-vendor': ['lucide-react', 'zustand']
        }
      }
    }
  }
})
