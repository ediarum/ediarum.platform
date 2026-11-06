/**
 * Entry of the mock app: a minimal implementation of the platform's mount contract, used for
 * local development and as a worked example for docs/integrating-an-app.md.
 */
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { CONTRACT_VERSION, type Mount } from '../../../src/contract'
import MockApp from './MockApp.vue'
import { CONTEXT, routes } from './routes'

export { CONTRACT_VERSION as contractVersion }

export const mount: Mount = (el, ctx) => {
  const router = createRouter({ history: createWebHistory(ctx.routerBase), routes })
  const app = createApp(MockApp).provide(CONTEXT, ctx).use(router)
  app.mount(el)
  return () => {
    app.unmount()
    // Stop listening to popstate; the next mount creates a fresh router.
    router.options.history.destroy()
  }
}
