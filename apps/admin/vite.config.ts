import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
  },
  server: {
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
