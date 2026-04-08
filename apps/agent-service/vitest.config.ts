import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    env: process.env.CI ? undefined : { ...process.env },
    setupFiles: ['./src/test/setup-arclay-home.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'src/**/*.test.ts',
        'src/test/**',
        '**/*.d.ts',
        '**/types.ts',
        '**/interface.ts',
        '**/index.ts',
        'scripts/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared-types': path.resolve(__dirname, '../shared-types/src'),
    },
  },
})
