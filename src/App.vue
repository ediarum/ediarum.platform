<script setup lang="ts">
import TopBar from './components/TopBar.vue'
import { computed } from 'vue'
import { useAuthStore } from './auth/store'
import { useControlsStore } from './controls/store'
import { strings } from './strings'

const auth = useAuthStore()
const controls = useControlsStore()
// One header only: while the mounted app shows the platform controls, it is the header.
const showTopBar = computed(() => auth.user !== null && !controls.appShowsControls)
</script>

<template>
  <div class="ep-shell">
    <a class="ep-skip-link" href="#ep-main">{{ strings.nav.skipToContent }}</a>
    <TopBar v-if="showTopBar" />
    <main id="ep-main" class="ep-shell__main" tabindex="-1">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
/* Continues the height chain from styles.css down to the mounted app. */
.ep-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.ep-shell__main {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.ep-shell__main:focus {
  outline: none;
}

.ep-skip-link {
  position: absolute;
  left: var(--ep-space-2);
  top: -100px;
  z-index: 1001;
  padding: var(--ep-space-2) var(--ep-space-3);
  border-radius: var(--ep-radius);
  background: var(--ep-color-bg);
  color: var(--ep-color-accent);
}

.ep-skip-link:focus {
  top: var(--ep-space-2);
}
</style>
