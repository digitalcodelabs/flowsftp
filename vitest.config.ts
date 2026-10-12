import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Logic under test is framework-free (pure helpers) or Pinia stores with Tauri mocked.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
