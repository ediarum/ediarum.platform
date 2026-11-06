/**
 * Dev-server plugin (only active in `vite` serve mode):
 *
 * - serves /config/apps.json from a local file instead of public/config/apps.json
 * - serves app bundles from local build directories (EDIARUM_DEV_BUNDLES, see ./appOverrides.ts)
 * - with `mock: true` (npm run dev):
 *   - the in-memory auth and app backends from ./mockBackend.ts under /api
 *   - the mock app: dev/mock-app is built in watch mode by a separate Vite build, exactly like
 *     a real app, and dist/ is served under /apps/mock/. Serving it as a real bundle
 *     (own Vue and vue-router copy, loaded with a native import()) exercises the same code
 *     paths as production, which transforming it with the platform's dev server would not.
 *
 * Apps overridden with EDIARUM_DEV_BACKENDS / EDIARUM_DEV_BUNDLES are skipped by the mocks.
 */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin, type ViteDevServer } from 'vite'
import { overriddenIds, type AppOverrides } from './appOverrides.ts'
import { createMockBackend } from './mockBackend.ts'

const DEV_DIR = fileURLToPath(new URL('.', import.meta.url))
const MOCK_APP_DIST = join(DEV_DIR, 'mock-app', 'dist')

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
}

export interface DevPluginOptions {
  /** Path of the apps.json to serve at /config/apps.json. */
  appsJson: string
  /** Serve mock backends and the mock app (false when proxying to a real stack). */
  mock: boolean
  /** Apps pointed at local services (URL overrides are proxied by vite.config.ts). */
  overrides: AppOverrides
}

function serveAppsJson(server: ViteDevServer, file: string): void {
  server.middlewares.use('/config/apps.json', (_req, res, next) => {
    readFile(file).then((content) => {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-cache')
      res.end(content)
    }, next)
  })
}

/** Serves an app's build directory at /apps/<id>/, with the caching of a real app container. */
function serveBundle(server: ViteDevServer, id: string, dir: string): void {
  server.middlewares.use(`/apps/${id}/`, (req, res) => {
    const relative = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^[/\\]+/, '')
    const file = resolve(dir, relative)
    if (!file.startsWith(dir + sep)) {
      res.statusCode = 404
      res.end()
      return
    }
    stat(file).then(
      (info) => {
        if (!info.isFile()) throw new Error('not a file')
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
        // Same caching as a real app container (see docs/integrating-an-app.md).
        res.setHeader('Cache-Control', relative === 'embed.js' ? 'no-cache' : 'public, max-age=31536000, immutable')
        createReadStream(file).pipe(res)
      },
      () => {
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/plain')
        res.end(relative === 'embed.js' ? `No embed.js in ${dir} (yet); is the build running?` : 'Not found')
      },
    )
  })
}

async function watchMockApp(server: ViteDevServer): Promise<void> {
  const watcher = await build({
    configFile: join(DEV_DIR, 'mock-app', 'vite.config.ts'),
    logLevel: 'warn',
    build: { watch: {} },
  })
  if ('close' in watcher) server.httpServer?.on('close', () => void watcher.close())
}

export function ediarumDev({ appsJson, mock, overrides }: DevPluginOptions): Plugin {
  const skip = overriddenIds(overrides)
  return {
    name: 'ediarum-dev',
    apply: 'serve',
    configureServer(server) {
      const { logger } = server.config
      serveAppsJson(server, appsJson)
      for (const [id, dir] of overrides.bundleDirs) {
        serveBundle(server, id, dir)
        logger.info(`  /apps/${id}/ → ${dir}`)
      }
      for (const [id, url] of overrides.bundleServers) logger.info(`  /apps/${id}/ → ${url} (dev server)`)
      for (const [id, url] of overrides.backends) logger.info(`  /api/${id}/ → ${url}/`)
      if (!mock) return
      server.middlewares.use(createMockBackend({ skipApps: skip.backends }))
      if (!skip.bundles.has('mock')) {
        serveBundle(server, 'mock', MOCK_APP_DIST)
        watchMockApp(server).catch((error: unknown) => logger.error(`[mock-app] ${String(error)}`))
      }
    },
  }
}
