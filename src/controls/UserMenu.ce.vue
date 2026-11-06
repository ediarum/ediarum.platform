<script setup lang="ts">
/**
 * `<ediarum-user-menu>`: the user's name, opening Profile and Log out. Inside an app it reports
 * itself to the controls store, which hides the platform's top bar while it is there.
 */
import { computed, onBeforeUnmount, onMounted, useHost } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../auth/store'
import { currentRouterPath } from '../router/history'
import { strings } from '../strings'
import PopoverMenu, { type MenuItem } from './PopoverMenu.ce.vue'
import { useControlsStore } from './store'

const auth = useAuthStore()
const controls = useControlsStore()
const router = useRouter()
const host = useHost()

async function logout(): Promise<void> {
  const next = currentRouterPath(import.meta.env.BASE_URL)
  try {
    await auth.logout()
  } catch (error) {
    // The local session is cleared anyway; the server session expires on its own.
    console.error('[ediarum.platform] logout failed', error)
  }
  await router.push({ name: 'login', query: { next } })
}

const items = computed<MenuItem[]>(() => [
  { key: 'profile', label: strings.nav.profile, to: '/profile' },
  { key: 'logout', label: strings.nav.logout, action: () => void logout() },
])

// Captured on mount: the element is already detached when it unmounts.
let appId: string | undefined
onMounted(() => {
  appId = host?.closest<HTMLElement>('.ep-apphost__app')?.dataset.app
  if (appId) controls.menuConnected(appId)
})
onBeforeUnmount(() => {
  if (appId) controls.menuDisconnected(appId)
})
</script>

<template>
  <PopoverMenu :items="items" :label="strings.nav.userMenu" align="end">{{ auth.user?.name }}</PopoverMenu>
</template>
