import type { AppConfig } from '../config/validateApps'
import type { PlatformUser } from '../contract'
import { appIdOf } from './history'

/** An app is visible to a user if it requires no roles or the user has at least one of them. */
export function hasAccess(app: AppConfig, user: PlatformUser | null): boolean {
  if (app.roles.length === 0) return true
  return user !== null && app.roles.some((role) => user.roles.includes(role))
}

export function visibleApps(apps: readonly AppConfig[], user: PlatformUser | null): AppConfig[] {
  return apps.filter((app) => hasAccess(app, user))
}

export interface DefaultTargetInput {
  /** Already validated `next` (see validateNext), or null. */
  next: string | null
  apps: readonly AppConfig[]
  user: PlatformUser
  /** Id of the last used app, from localStorage. */
  lastAppId: string | null
}

/**
 * Where to go after login or at '/': valid `next` → last used app (if still accessible) →
 * first accessible app → '/profile'. A `next` pointing into an app the user cannot access
 * is skipped.
 */
export function defaultTarget({ next, apps, user, lastAppId }: DefaultTargetInput): string {
  if (next !== null) {
    const appId = appIdOf(next, apps.map((app) => app.id))
    const app = apps.find((a) => a.id === appId)
    if (!app || hasAccess(app, user)) return next
  }
  const accessible = visibleApps(apps, user)
  const last = accessible.find((app) => app.id === lastAppId)
  if (last) return `/${last.id}`
  const first = accessible[0]
  return first ? `/${first.id}` : '/profile'
}
