import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('ediarum-') } } })],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    // Vitest forces `base: '/'`; mirror the production base from vite.config.ts.
    env: { BASE_URL: '/' },
  },
})
