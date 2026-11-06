<script setup lang="ts">
/** Shown instead of the platform when `apps.json` is missing or invalid (mounted without router). */
import { strings } from '../strings'

defineProps<{ details: readonly string[] }>()
</script>

<template>
  <main class="ep-page" role="alert">
    <h1>{{ strings.config.title }}</h1>
    <p>{{ strings.config.text }}</p>
    <h2>{{ strings.config.details }}</h2>
    <ul>
      <li v-for="(detail, i) in details" :key="i"><code>{{ detail }}</code></li>
    </ul>
  </main>
</template>
