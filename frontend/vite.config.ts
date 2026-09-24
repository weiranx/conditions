import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { mockApiPlugin } from './dev/mock-api.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(process.env.VITE_MOCK_API === 'true' ? [mockApiPlugin({databasePath: path.resolve(__dirname, '.mock/database.json')})] : [])],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_BACKEND_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
