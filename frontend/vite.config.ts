import { defineConfig } from 'vite'

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          forcegraph: ['3d-force-graph'],
          markdown: ['marked', 'dompurify'],
        },
      },
    },
  },
})
