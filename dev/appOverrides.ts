/**
 * Points single apps of the dev server at real local services, while everything else (login,
 * other apps) stays as configured. Set in the environment or `.env.local`:
 *
 *   EDIARUM_DEV_BACKENDS=zotero=http://localhost:8004
 *     /api/zotero/… → http://localhost:8004/… (prefix stripped, like the production proxy)
 *
 *   EDIARUM_DEV_BUNDLES=zotero=../ediarum.zotero/frontend/dist
 *     /apps/zotero/… → files from that build directory (e.g. `vite build --watch`)
 *
 *   EDIARUM_DEV_BUNDLES=zotero=http://localhost:5174
 *     /apps/zotero/… → the app's Vite dev server (base '/apps/zotero/'), including its HMR
 *     WebSocket; /apps/zotero/embed.js is served from the app's src/embed.ts
 *
 * Several apps are separated by commas: `zotero=http://localhost:8004,index=http://localhost:8005`.
 * Works with `npm run dev` (mock login) and `npm run dev:proxy` (real stack); the overrides take
 * precedence over the mocks and over EDIARUM_PROXY_TARGET.
 */
import { resolve } from 'node:path'
import type { ProxyOptions } from 'vite'

export interface AppOverrides {
  /** App id → backend base URL. */
  backends: Map<string, string>
  /** App id → build directory (absolute). */
  bundleDirs: Map<string, string>
  /** App id → Vite dev server URL. */
  bundleServers: Map<string, string>
}

const ID_PATTERN = /^[a-z0-9-]+$/
const isUrl = (value: string) => /^https?:\/\/[^/]/.test(value)

function parseList(name: string, value: string | undefined): [string, string][] {
  if (!value?.trim()) return []
  return value.split(',').map((part) => {
    const index = part.indexOf('=')
    const id = part.slice(0, index).trim()
    const target = part.slice(index + 1).trim()
    if (index < 1 || !ID_PATTERN.test(id) || target === '') {
      throw new Error(`${name}: expected "<id>=<target>[,<id>=<target>…]", got "${part.trim()}"`)
    }
    return [id, target]
  })
}

export function parseAppOverrides(env: Record<string, string | undefined>, cwd: string = process.cwd()): AppOverrides {
  const overrides: AppOverrides = { backends: new Map(), bundleDirs: new Map(), bundleServers: new Map() }
  for (const [id, target] of parseList('EDIARUM_DEV_BACKENDS', env.EDIARUM_DEV_BACKENDS)) {
    if (!isUrl(target)) throw new Error(`EDIARUM_DEV_BACKENDS: "${id}" needs an http(s) URL, got "${target}"`)
    overrides.backends.set(id, target.replace(/\/+$/, ''))
  }
  for (const [id, target] of parseList('EDIARUM_DEV_BUNDLES', env.EDIARUM_DEV_BUNDLES)) {
    if (isUrl(target)) overrides.bundleServers.set(id, target.replace(/\/+$/, ''))
    else overrides.bundleDirs.set(id, resolve(cwd, target))
  }
  return overrides
}

/** Ids whose backend or bundle is overridden, so the mocks leave them alone. */
export function overriddenIds(overrides: AppOverrides): { backends: Set<string>; bundles: Set<string> } {
  return {
    backends: new Set(overrides.backends.keys()),
    bundles: new Set([...overrides.bundleDirs.keys(), ...overrides.bundleServers.keys()]),
  }
}

/**
 * Vite proxy entries for URL overrides. Spread them before any broader entries (`/api`,
 * `/apps/`): Vite uses the first matching key.
 */
export function overrideProxies(overrides: AppOverrides): Record<string, ProxyOptions> {
  const proxies: Record<string, ProxyOptions> = {}
  for (const [id, target] of overrides.backends) {
    const prefix = `/api/${id}`
    proxies[`${prefix}/`] = { target, rewrite: (path) => path.slice(prefix.length) }
  }
  for (const [id, target] of overrides.bundleServers) {
    const entry = new RegExp(`^/apps/${id}/embed\\.js(?=$|\\?)`)
    proxies[`/apps/${id}/`] = {
      target,
      // The app's HMR client connects to ws://<platform>/apps/<id>/; the platform's own HMR only uses '/'.
      ws: true,
      // In dev mode there is no built embed.js; the entry is the source file the build starts from.
      rewrite: (path) => path.replace(entry, `/apps/${id}/src/embed.ts`),
    }
  }
  return proxies
}
