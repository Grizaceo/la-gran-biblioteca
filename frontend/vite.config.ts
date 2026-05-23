import { defineConfig } from 'vite'

// 127.0.0.1 evita que el proxy use ::1 mientras uvicorn escucha solo en IPv4 (típico en WSL).
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:3001'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        timeout: 120_000,
        proxyTimeout: 120_000,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url?.includes('/stream')) {
              proxyReq.setHeader('Accept', 'text/event-stream')
            }
          })
        },
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/3d-force-graph')) return 'forcegraph'
          if (id.includes('node_modules/marked') || id.includes('node_modules/dompurify')) {
            return 'markdown'
          }
        },
      },
    },
  },
})
