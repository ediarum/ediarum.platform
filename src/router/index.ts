/**
 * The platform router: fixed platform pages, one route per app from `apps.json`, the login guard
 * and the global 401 handling.
 */
import { createRouter, type Router, type RouterHistory } from 'vue-router'
import { setUnauthorizedHandler } from '../api/client'
import { useAuthStore } from '../auth/store'
import type { AppConfig } from '../config/validateApps'
import AppRouteView from '../views/AppRouteView.vue'
import LoginView from '../views/LoginView.vue'
import NotFoundView from '../views/NotFoundView.vue'
import ProfileView from '../views/ProfileView.vue'
import { currentRouterPath } from './history'
import { targetAfterLogin } from './targetAfterLogin'

declare module 'vue-router' {
  interface RouteMeta {
    /** Reachable without login. */
    public?: boolean
  }
}

export function createPlatformRouter(apps: readonly AppConfig[], history: RouterHistory): Router {
  const router = createRouter({
    history,
    routes: [
      // Never rendered: the guard below always redirects '/' to the default target.
      { path: '/', name: 'home', component: NotFoundView },
      { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
      { path: '/profile', name: 'profile', component: ProfileView },
      ...apps.map((app) => ({
        path: `/${app.id}/:rest(.*)*`,
        name: `app:${app.id}`,
        component: AppRouteView,
        props: { app },
      })),
      { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView, meta: { public: true } },
    ],
  })

  router.beforeEach((to) => {
    const auth = useAuthStore()
    if (!auth.user) {
      if (to.meta.public) return true
      return { name: 'login', query: to.name === 'home' ? {} : { next: to.fullPath } }
    }
    if (to.name === 'login') return targetAfterLogin(router, apps, auth.user, to.query.next)
    if (to.name === 'home') return targetAfterLogin(router, apps, auth.user, null)
    return true
  })

  return router
}

/**
 * On a 401 from any API call (platform or app): forget the user, which unmounts the current app,
 * and go to the login page, which returns to the current URL afterwards. The URL is read from
 * `window.location`, because navigation inside an app does not update the platform's route.
 */
export function installUnauthorizedHandler(router: Router, base: string = import.meta.env.BASE_URL): void {
  setUnauthorizedHandler(() => {
    const auth = useAuthStore()
    if (auth.user) auth.sessionExpired = true
    auth.clear()
    if (router.currentRoute.value.name === 'login') return
    void router.push({ name: 'login', query: { next: currentRouterPath(base) } })
  })
}
