import type { Router } from 'vue-router'
import type { AppConfig } from '../config/validateApps'
import type { PlatformUser } from '../contract'
import { defaultTarget } from './defaultTarget'
import { getLastAppId } from './lastApp'
import { validateNext } from './next'

/** Where to go after login (or when a logged-in user opens /login or /), given the raw `next`. */
export function targetAfterLogin(router: Router, apps: readonly AppConfig[], user: PlatformUser, next: unknown): string {
  const isKnownRoute = (path: string) => {
    const name = router.resolve(path).name
    return name !== 'not-found' && name !== 'login'
  }
  return defaultTarget({ next: validateNext(next, isKnownRoute), apps, user, lastAppId: getLastAppId() })
}
