import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@shared-types': path.resolve(__dirname, '../../packages/shared-types/src')
    }
  },
  server: {
    port: 1420,
    watch: {
      ignored: [
        '**/apps/agent-service/workspace/**',
        '**/.arclay/**',
      ],
    },
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.VITE_API_PORT || '2026'}`,
        changeOrigin: true
      }
    }
  }
})
