/**
 * Whether the mounted app shows the platform controls in its own header. If it does, the
 * platform hides its top bar, so there is only one header.
 *
 * An app shows the controls by rendering `<ediarum-user-menu>` (and `<ediarum-home>`) somewhere
 * inside its element; there is no flag to declare. The user menu reports itself here when it
 * connects and disconnects. Whatever an app did the last time it was mounted is remembered, so
 * the top bar does not flash while the app is loaded again.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type AppStatus = 'loading' | 'mounted' | 'error'

export const useControlsStore = defineStore('platform-controls', () => {
  /** The app AppHost currently hosts, if any. */
  const active = ref<{ id: string; status: AppStatus } | null>(null)
  /** Connected `<ediarum-user-menu>` elements per app id. */
  const menus = ref<Record<string, number>>({})
  /** Per app id: did it show the controls when it was last mounted? Unknown until then. */
  const hosts = ref<Record<string, boolean>>({})

  /** True if the platform should hide its top bar. Never while an app shows an error. */
  const appShowsControls = computed(() => {
    const app = active.value
    return app !== null && app.status !== 'error' && hosts.value[app.id] === true
  })

  function setStatus(id: string, status: AppStatus): void {
    active.value = { id, status }
  }

  function clearStatus(id: string): void {
    if (active.value?.id === id) active.value = null
  }

  function menuConnected(id: string): void {
    menus.value[id] = (menus.value[id] ?? 0) + 1
    hosts.value[id] = true
  }

  function menuDisconnected(id: string): void {
    const count = Math.max((menus.value[id] ?? 0) - 1, 0)
    menus.value[id] = count
    // The app removed the menu while staying mounted: show the top bar again.
    if (count === 0 && active.value?.id === id && active.value.status === 'mounted') hosts.value[id] = false
  }

  /**
   * Called a while after mounting: an app expected to show the controls (from its last mount)
   * that has not rendered the user menu by now does not show them.
   */
  function settle(id: string): void {
    if (active.value?.id === id && active.value.status === 'mounted' && !menus.value[id]) hosts.value[id] = false
  }

  return { active, menus, hosts, appShowsControls, setStatus, clearStatus, menuConnected, menuDisconnected, settle }
})
