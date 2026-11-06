import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useAuthStore } from './auth/store'
import { APPS, ConfigError, loadApps } from './config/loadApps'
import { installPlatformControls } from './controls'
import type { AppConfig } from './config/validateApps'
import { createPlatformRouter, installUnauthorizedHandler } from './router'
import { createPlatformHistory } from './router/history'
import ConfigErrorView from './views/ConfigErrorView.vue'
import './styles.css'

const MOUNT_POINT = '#ediarum-platform'

async function start(): Promise<void> {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)

  // Who is logged in; any failure other than 401 counts as logged out, and the login page
  // then reports the actual problem (e.g. backend unreachable).
  const session = auth.init().catch((error: unknown) => {
    console.error('[ediarum.platform] could not determine the session', error)
  })

  let apps: AppConfig[]
  try {
    ;[apps] = await Promise.all([loadApps(), session])
  } catch (error) {
    const details = error instanceof ConfigError ? error.details : [String(error)]
    createApp(ConfigErrorView, { details }).mount(MOUNT_POINT)
    return
  }

  const base = import.meta.env.BASE_URL
  const router = createPlatformRouter(apps, createPlatformHistory({ base, appIds: apps.map((app) => app.id) }))
  installUnauthorizedHandler(router, base)
  installPlatformControls({ pinia, router, apps })

  createApp(App).use(pinia).provide(APPS, apps).use(router).mount(MOUNT_POINT)
}

void start()
