import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { parseAppOverrides, overrideProxies } from './dev/appOverrides.ts'
import { ediarumDev } from './dev/devPlugin.ts'

/**
 * `npm run dev`: mock auth backend and mock app (see dev/devPlugin.ts).
 * `npm run dev:proxy` (mode "proxy"): forwards /api and /apps to EDIARUM_PROXY_TARGET,
 * e.g. a local compose stack; apps.json comes from EDIARUM_APPS_JSON (default: the shipped one).
 * In both modes, EDIARUM_DEV_BACKENDS / EDIARUM_DEV_BUNDLES point single apps at local services
 * (see dev/appOverrides.ts).
 */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'EDIARUM_'), ...process.env }
  const proxyMode = mode === 'proxy'
  const target = env.EDIARUM_PROXY_TARGET
  if (proxyMode && !target) {
    throw new Error('dev:proxy needs EDIARUM_PROXY_TARGET, e.g. EDIARUM_PROXY_TARGET=http://localhost:8080')
  }

  const overrides = parseAppOverrides(env)

  return {
    base: '/',
    plugins: [
      // <ediarum-home> and <ediarum-user-menu> are custom elements (src/controls).
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('ediarum-') } } }),
      ediarumDev({
        mock: !proxyMode,
        appsJson: env.EDIARUM_APPS_JSON ?? (proxyMode ? 'public/config/apps.json' : 'dev/apps.json'),
        overrides,
      }),
    ],
    server: {
      proxy: {
        // First: Vite uses the first matching key, and these are more specific.
        ...overrideProxies(overrides),
        ...(proxyMode
          ? {
              '/api': { target, changeOrigin: true },
              '/apps/': { target, changeOrigin: true },
            }
          : {}),
      },
    },
  }
})
