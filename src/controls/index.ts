/**
 * The platform controls as custom elements, `<ediarum-home>` and `<ediarum-user-menu>`. The
 * platform's top bar uses them, and so can an app's own header (docs/integrating-an-app.md, 3.10).
 *
 * Each element is a small Vue app in a shadow root, sharing the platform's store, router and app
 * list, so it behaves exactly like the rest of the platform wherever it is placed.
 */
import type { Pinia } from 'pinia'
import { defineCustomElement, type App } from 'vue'
import type { Router } from 'vue-router'
import { APPS } from '../config/loadApps'
import type { AppConfig } from '../config/validateApps'
import HomeMenu from './HomeMenu.ce.vue'
import UserMenu from './UserMenu.ce.vue'

export interface ControlsContext {
  pinia: Pinia
  router: Router
  apps: readonly AppConfig[]
}

// Custom elements cannot be redefined; they read whatever context was installed last (tests
// install a fresh one per test).
let context: ControlsContext | null = null

function configureApp(app: App): void {
  if (!context) throw new Error('[ediarum.platform] platform controls used before installPlatformControls()')
  app.use(context.pinia).use(context.router).provide(APPS, context.apps)
}

const ELEMENTS = {
  'ediarum-home': HomeMenu,
  'ediarum-user-menu': UserMenu,
}

export function installPlatformControls(ctx: ControlsContext): void {
  context = ctx
  for (const [name, component] of Object.entries(ELEMENTS)) {
    if (!customElements.get(name)) customElements.define(name, defineCustomElement(component, { configureApp }))
  }
}
