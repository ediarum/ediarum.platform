<script setup lang="ts">
/**
 * Loads an app's ES module at runtime and mounts it according to src/contract.ts.
 *
 * One AppHost instance hosts exactly one app for one user. The parent keys it by app id and
 * user, so switching apps destroys this instance (and unmounts the app); navigation within the
 * app does not touch it.
 */
import { inject, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { CONTRACT_VERSION, type MountContext, type PlatformUser } from '../contract'
import type { AppConfig } from '../config/validateApps'
import { useControlsStore } from '../controls/store'
import { strings } from '../strings'
import { MODULE_LOADER, defaultModuleLoader } from './moduleLoader'

const props = defineProps<{
  app: AppConfig
  user: PlatformUser
  onUnauthorized: () => void
}>()

const loadModule = inject(MODULE_LOADER, defaultModuleLoader)
const controls = useControlsStore()
const container = useTemplateRef<HTMLDivElement>('container')

type State = { kind: 'loading' } | { kind: 'mounted' } | { kind: 'error'; message: string; retryable: boolean }
const state = ref<State>({ kind: 'loading' })

let attempt = 0
let disposed = false
let mountEl: HTMLElement | null = null
let unmountApp: (() => void) | null = null
let settleTimer: ReturnType<typeof setTimeout> | undefined

/** How long an app may take to render its header (e.g. after its router is ready). */
const CONTROLS_GRACE_MS = 2000

function isRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
}

/** Browsers may cache failed module fetches; a retry uses a distinct URL. */
function entryUrl(): string {
  if (attempt === 0) return props.app.entry
  const url = new URL(props.app.entry, window.location.href)
  url.searchParams.set('platform-retry', String(attempt))
  return url.href
}

function fail(message: string, retryable: boolean, error?: unknown): void {
  if (error !== undefined) console.error(`[ediarum.platform] ${props.app.id}:`, error)
  state.value = { kind: 'error', message, retryable }
  controls.setStatus(props.app.id, 'error')
}

function teardown(): void {
  clearTimeout(settleTimer)
  if (unmountApp) {
    try {
      unmountApp()
    } catch (error) {
      console.error(`[ediarum.platform] ${props.app.id}: unmount failed`, error)
    }
    unmountApp = null
  }
  mountEl?.remove()
  mountEl = null
}

async function load(): Promise<void> {
  state.value = { kind: 'loading' }
  controls.setStatus(props.app.id, 'loading')
  const label = props.app.label

  let mod: unknown
  try {
    mod = await loadModule(entryUrl())
  } catch (error) {
    if (!disposed) fail(strings.app.unavailable(label), true, error)
    return
  } finally {
    attempt++
  }
  if (disposed || !container.value) return

  if (!isRecord(mod) || mod.contractVersion !== CONTRACT_VERSION) {
    const got = isRecord(mod) && mod.contractVersion !== undefined ? String(mod.contractVersion) : '–'
    fail(strings.app.incompatible(label, got, CONTRACT_VERSION), false)
    return
  }
  if (typeof mod.mount !== 'function') {
    fail(strings.app.invalidModule(label), false)
    return
  }

  const ctx: MountContext = {
    routerBase: `${import.meta.env.BASE_URL}${props.app.id}/`,
    apiBase: props.app.apiBase,
    user: { name: props.user.name, roles: [...props.user.roles], projects: [...props.user.projects] },
    onUnauthorized: () => props.onUnauthorized(),
  }
  mountEl = document.createElement('div')
  mountEl.className = 'ep-apphost__app'
  mountEl.dataset.app = props.app.id
  container.value.appendChild(mountEl)
  try {
    const result: unknown = mod.mount(mountEl, ctx)
    if (typeof result !== 'function') {
      teardown()
      fail(strings.app.invalidModule(label), false)
      return
    }
    unmountApp = result as () => void
  } catch (error) {
    teardown()
    fail(strings.app.mountFailed(label), true, error)
    return
  }
  state.value = { kind: 'mounted' }
  controls.setStatus(props.app.id, 'mounted')
  const id = props.app.id
  settleTimer = setTimeout(() => controls.settle(id), CONTROLS_GRACE_MS)
}

function retry(): void {
  teardown()
  void load()
}

onMounted(() => void load())

onBeforeUnmount(() => {
  disposed = true
  teardown()
  controls.clearStatus(props.app.id)
})
</script>

<template>
  <div class="ep-apphost">
    <div v-if="state.kind === 'loading'" class="ep-apphost__status" role="status">
      {{ strings.app.loading(app.label) }}
    </div>
    <div v-else-if="state.kind === 'error'" class="ep-apphost__status ep-apphost__status--error" role="alert">
      <p>{{ state.message }}</p>
      <button v-if="state.retryable" type="button" class="ep-button" @click="retry">{{ strings.app.retry }}</button>
    </div>
    <div ref="container" class="ep-apphost__container" :hidden="state.kind !== 'mounted'"></div>
  </div>
</template>

<style scoped>
.ep-apphost,
.ep-apphost__container {
  height: 100%;
}

.ep-apphost__container > :deep(.ep-apphost__app) {
  height: 100%;
}

.ep-apphost__status {
  padding: var(--ep-space-8) var(--ep-space-6);
  color: var(--ep-color-muted);
}

.ep-apphost__status--error {
  color: var(--ep-color-text);
}

.ep-apphost__status p {
  margin: 0 0 var(--ep-space-4);
}
</style>
