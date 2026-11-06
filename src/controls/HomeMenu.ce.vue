<script setup lang="ts">
/** `<ediarum-home>`: the ediarum wordmark, opening a list of the apps the user may use. */
import { computed, inject } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../auth/store'
import { APPS } from '../config/loadApps'
import { visibleApps } from '../router/defaultTarget'
import { strings } from '../strings'
import PopoverMenu, { type MenuItem } from './PopoverMenu.ce.vue'

const auth = useAuthStore()
const route = useRoute()
const apps = inject(APPS, [])

// The route of an app stays the same while the app navigates internally, so match on the record.
const activeAppId = computed(() => {
  const name = route.name
  return typeof name === 'string' && name.startsWith('app:') ? name.slice(4) : null
})

const items = computed<MenuItem[]>(() =>
  visibleApps(apps, auth.user).map((app) => ({
    key: app.id,
    label: app.label,
    to: `/${app.id}`,
    current: app.id === activeAppId.value,
  })),
)
</script>

<template>
  <PopoverMenu :items="items" :label="strings.nav.apps" :empty="strings.nav.noApps" align="start">
    <span class="ep-home__brand">{{ strings.productName }}</span>
  </PopoverMenu>
</template>

<style>
.ep-home__brand {
  font-weight: 700;
  font-size: 1.125em;
  color: var(--ep-controls-brand, var(--ep-color-brand, #e5312e));
}
</style>
