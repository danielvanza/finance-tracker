/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Deployed under a sub-path (e.g. /finances/): set FINANCES_BASE when building.
  base: process.env.FINANCES_BASE ?? '/',
  plugins: [react()],
  // Make sure bot-kit and the app share one React.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', rewrite: (p) => p.replace(/^\/api/, '') }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  }
})
