<script setup lang="ts">
/**
 * Mock app shell. Inline styles only: the app ships no CSS file, and nothing here may leak
 * into the platform page.
 */
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { CONTEXT } from './routes'

const ctx = inject(CONTEXT)!
const keypresses = ref(0)
const apiResult = ref('')

// A global listener, to check that unmounting really cleans up (see the key counter).
const onKey = () => keypresses.value++
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

async function callApi(): Promise<void> {
  const response = await fetch(`${ctx.apiBase}/whoami`, { headers: { Accept: 'application/json' } })
  if (response.status === 401) {
    ctx.onUnauthorized()
    return
  }
  apiResult.value = `${response.status} ${await response.text()}`
}
</script>

<template>
  <div data-mock-app style="display: flex; flex-direction: column; height: 100%; font-family: inherit">
    <!-- The app's own header, hosting the platform controls; the platform hides its top bar. -->
    <header
      style="display: flex; align-items: center; gap: 1rem; height: 3.25rem; padding: 0 0.75rem; flex: none;
        background: #2d3e50; color: #fff; --ep-controls-brand: #fff; --ep-controls-hover: rgb(255 255 255 / 0.15)"
    >
      <ediarum-home></ediarum-home>
      <strong style="font-weight: 500">Mock app</strong>
      <span style="flex: 1"></span>
      <ediarum-user-menu></ediarum-user-menu>
    </header>
    <div style="flex: 1; overflow-y: auto; padding: 1.5rem 2rem">
      <RouterView />
      <section style="margin-top: 2rem">
        <h2 style="font-size: 1rem">Mount context</h2>
        <dl style="display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1.5rem">
          <dt>routerBase</dt><dd style="margin: 0"><code>{{ ctx.routerBase }}</code></dd>
          <dt>apiBase</dt><dd style="margin: 0"><code>{{ ctx.apiBase }}</code></dd>
          <dt>user</dt><dd style="margin: 0"><code>{{ JSON.stringify(ctx.user) }}</code></dd>
          <dt>keydown events</dt><dd style="margin: 0" data-keypresses>{{ keypresses }}</dd>
        </dl>
        <p style="display: flex; gap: 0.5rem">
          <button type="button" @click="callApi">Call {{ ctx.apiBase }}/whoami</button>
          <button type="button" @click="ctx.onUnauthorized()">Simulate 401</button>
        </p>
        <p v-if="apiResult"><code>{{ apiResult }}</code></p>
      </section>
    </div>
  </div>
</template>
