import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: [],
    globals: true,
    exclude: ['**/node_modules/**', '**/.next/**', '**/tests/**', '**/*.spec.ts'],
    include: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // See lib/__mocks__/server-only.ts — keeps `import 'server-only'` modules
      // testable under jsdom without weakening the guard in the real build.
      'server-only': path.resolve(__dirname, 'lib/__mocks__/server-only.ts'),
    },
  },
})
