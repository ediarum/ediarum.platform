<script setup lang="ts">
import { strings } from '../strings'
</script>

<template>
  <div class="ep-page">
    <h1>{{ strings.notFound.title }}</h1>
    <p>{{ strings.notFound.text }}</p>
    <RouterLink to="/">{{ strings.notFound.home }}</RouterLink>
  </div>
</template>
