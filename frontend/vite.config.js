import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: process.env.ALIA_API_URL || 'http://127.0.0.1:8001', ws: true },
      '/health': process.env.ALIA_API_URL || 'http://127.0.0.1:8001',
    },
  },
})
