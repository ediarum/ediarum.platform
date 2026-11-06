<script setup lang="ts">
import { useRoute } from 'vue-router'

defineProps<{ title: string; other: string }>()
const route = useRoute()
</script>

<template>
  <div>
    <h1 style="margin: 0 0 1rem; font-size: 1.5rem">{{ title }}</h1>
    <p>App-internal path: <code data-app-path>{{ route.fullPath }}</code></p>
    <nav style="display: flex; gap: 1rem">
      <RouterLink :to="{ name: other }">Go to the {{ other }} page</RouterLink>
      <RouterLink :to="{ name: 'item', params: { id: 42 }, query: { tab: 'notes' } }">Item 42</RouterLink>
    </nav>
  </div>
</template>
