/**
 * Builds the mock app exactly like a real app is built (see docs/integrating-an-app.md):
 * a single ES module `embed.js` with its own copy of Vue and vue-router, loaded by the platform
 * at runtime from /apps/mock/embed.js. The dev plugin (dev/devPlugin.ts) runs this build
 * in watch mode and serves dist/.
 *
 * The mock app has no CSS files, so it does not need vite-plugin-css-injected-by-js.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  base: '/apps/mock/',
  // The platform controls in the header are custom elements defined by the platform.
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('ediarum-') } } })],
  // No public dir, no env files from the platform.
  publicDir: false,
  envDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: 'src/embed.ts',
      // Keep the `mount` / `contractVersion` exports of the entry.
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: 'embed.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
