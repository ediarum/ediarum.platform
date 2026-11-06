<script setup lang="ts">
/**
 * Route component for `/<id>/:rest(.*)*`. The same instance may be reused across apps by the
 * router, so AppHost is keyed by app id and user: switching apps (or users) fully unmounts the
 * previous app, while changes of `:rest` (navigation within the app) keep it mounted.
 */
import { computed, watch } from 'vue'
import AppHost from '../components/AppHost.vue'
import { notifyUnauthorized } from '../api/client'
import { useAuthStore } from '../auth/store'
import type { AppConfig } from '../config/validateApps'
import { hasAccess } from '../router/defaultTarget'
import { setLastAppId } from '../router/lastApp'
import { strings } from '../strings'

const props = defineProps<{ app: AppConfig }>()
const auth = useAuthStore()
const allowed = computed(() => hasAccess(props.app, auth.user))

watch(
  () => [props.app.id, allowed.value] as const,
  ([id, ok]) => {
    if (ok) setLastAppId(id)
  },
  { immediate: true },
)
</script>

<template>
  <AppHost
    v-if="auth.user && allowed"
    :key="`${app.id}\u0000${auth.user.name}`"
    :app="app"
    :user="auth.user"
    :on-unauthorized="notifyUnauthorized"
  />
  <div v-else-if="auth.user" class="ep-page">
    <h1>{{ strings.noAccess.title }}</h1>
    <p>{{ strings.noAccess.text(app.label) }}</p>
    <RouterLink to="/">{{ strings.notFound.home }}</RouterLink>
  </div>
</template>
