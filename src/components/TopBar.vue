<script setup lang="ts">
/**
 * The platform's own header: the app menu on the left, the user menu on the right. Both are the
 * same custom elements an app places in its header (src/controls); App.vue hides this bar while
 * the mounted app shows them.
 */
</script>

<template>
  <header class="ep-topbar">
    <ediarum-home></ediarum-home>
    <ediarum-user-menu></ediarum-user-menu>
  </header>
</template>

<style scoped>
.ep-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ep-space-6);
  height: var(--ep-topbar-height);
  padding: 0 var(--ep-space-3);
  border-bottom: 1px solid var(--ep-color-border);
  background: var(--ep-color-surface);
  color: var(--ep-color-text);
}
</style>
