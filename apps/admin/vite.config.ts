import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const workerBaseUrl = (
  process.env.VITE_WORKER_ADMIN_BASE_URL ??
  'https://mexican-golf-cart-worker-dev.explaincaption.workers.dev'
).replace(/\/$/, '')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
  },
  server: {
    // Shopify dev tunnel hostnames rotate on every run; allow them in development.
    allowedHosts: true,
    proxy: {
      '/proxy': {
        target: workerBaseUrl,
        changeOrigin: true,
        secure: true,
      },
      '/auth': {
        target: workerBaseUrl,
        changeOrigin: true,
        secure: true,
      },
      '/webhooks': {
        target: workerBaseUrl,
        changeOrigin: true,
        secure: true,
      },
    },
    watch: {
      followSymlinks: false,
    },
  },
  build: {
    // Increase chunk size warning limit to 700KB for single-page admin apps
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor dependencies into separate chunks
          vendor: ['react', 'react-dom'],
          polaris: ['@shopify/polaris'],
        },
      },
    },
  },
})
