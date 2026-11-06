/**
 * History for the platform router, safe to share `window.history` with the mounted app's router.
 *
 * Problem: vue-router (both the platform's and the app's copy) stores the current location in
 * `history.state.current` *relative to its own base* and, before every push, rewrites the
 * current entry's URL as `base + history.state.current`. With two routers on different bases
 * ('/' and '/zotero/') each one reads the other's value and corrupts the entry
 * (e.g. '/zotero/b' becomes '/b', so "back" leads nowhere).
 *
 * Fix, entirely on the platform side:
 * - before the platform router writes, `state.current` is set to the platform-relative form of the
 *   real current URL;
 * - after it writes, if the new URL lies inside an app's area (`/<id>/…`), `state.current`
 *   is converted to that app's relative form, which is what the app's router expects;
 * - if the platform navigates *within* the area of the app that was already shown (e.g. the user
 *   clicks the active app in the menu), a synthetic `popstate` is dispatched so the app's router
 *   follows the URL change without being remounted. The platform ignores that event itself.
 *
 * App routers never write entries outside their own area (they are unmounted before), and the
 * platform router never trusts `state.current` (it reads `window.location`), so both stay correct.
 */
import { createWebHistory, type RouterHistory } from 'vue-router'

export interface PlatformHistoryOptions {
  /** Router base, e.g. '/'. */
  base: string
  /** Ids of the hosted apps; `/<base><id>/…` belongs to that app's router. */
  appIds: readonly string[]
}

function trimSlash(base: string): string {
  return base.replace(/\/+$/, '')
}

/** Current URL path + search + hash, relative to `base` (e.g. '/zotero/a?x=1'). */
export function currentRouterPath(base: string, loc: Location = window.location): string {
  const prefix = trimSlash(base)
  let path = loc.pathname
  if (path === prefix || path.startsWith(`${prefix}/`)) path = path.slice(prefix.length)
  return `${path || '/'}${loc.search}${loc.hash}`
}

/** The app id whose area contains the given router path, if any. */
export function appIdOf(routerPath: string, appIds: readonly string[]): string | null {
  const segment = /^\/([^/?#]+)/.exec(routerPath)?.[1]
  return segment !== undefined && appIds.includes(segment) ? segment : null
}

function setStateCurrent(current: string): void {
  const state: unknown = window.history.state
  if (typeof state !== 'object' || state === null) return
  if ((state as { current?: unknown }).current === current) return
  window.history.replaceState({ ...state, current }, '')
}

export function createPlatformHistory({ base, appIds }: PlatformHistoryOptions): RouterHistory {
  const inner = createWebHistory(base)
  let dispatchingSynthetic = false

  const beforeWrite = (): string | null => {
    const path = currentRouterPath(base)
    setStateCurrent(path)
    return appIdOf(path, appIds)
  }

  const afterWrite = (previousAppId: string | null): void => {
    const path = currentRouterPath(base)
    const appId = appIdOf(path, appIds)
    if (appId === null) return
    setStateCurrent(path.slice(appId.length + 1) || '/')
    if (appId === previousAppId) {
      dispatchingSynthetic = true
      try {
        window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
      } finally {
        dispatchingSynthetic = false
      }
    }
  }

  return {
    get base() {
      return inner.base
    },
    // vue-router only reads this once, for the initial navigation.
    get location() {
      return currentRouterPath(base)
    },
    get state() {
      return inner.state
    },
    push(to, data) {
      const previousAppId = beforeWrite()
      inner.push(to, data)
      afterWrite(previousAppId)
    },
    replace(to, data) {
      const previousAppId = beforeWrite()
      inner.replace(to, data)
      afterWrite(previousAppId)
    },
    go(delta, triggerListeners) {
      inner.go(delta, triggerListeners)
    },
    listen(callback) {
      return inner.listen((to, from, info) => {
        if (!dispatchingSynthetic) callback(to, from, info)
      })
    },
    createHref(location) {
      return inner.createHref(location)
    },
    destroy() {
      inner.destroy()
    },
  }
}
