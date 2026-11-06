<script setup lang="ts">
/**
 * A button that opens a list of links and actions. Shared by the platform controls.
 *
 * The list is a popover (`popover="auto"`): it is rendered in the top layer, so an app header
 * with `overflow: hidden` or its own z-index cannot clip or cover it, and the browser closes it
 * on Escape and on clicks outside. It is placed below the button when it opens and closed when
 * the window is resized or the route changes.
 */
import { onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue'
import { useRoute } from 'vue-router'

export interface MenuItem {
  key: string
  label: string
  /** Platform route to open. */
  to?: string
  /** Action to run instead of a route. */
  action?: () => void
  /** Marks the item as the current page. */
  current?: boolean
}

const props = defineProps<{
  items: MenuItem[]
  /** Accessible name of the button, read before its visible content. */
  label: string
  /** Text shown in place of the items when there are none. */
  empty?: string
  /** Which edge of the button the list aligns with. */
  align: 'start' | 'end'
}>()

const id = useId()
const route = useRoute()
const open = ref(false)
const button = useTemplateRef<HTMLButtonElement>('button')
const panel = useTemplateRef<HTMLElement>('panel')

function close(): void {
  if (open.value) panel.value?.hidePopover()
}

function place(): void {
  const rect = button.value?.getBoundingClientRect()
  const el = panel.value
  if (!rect || !el) return
  el.style.top = `${rect.bottom + 4}px`
  if (props.align === 'start') {
    el.style.left = `${rect.left}px`
    el.style.right = ''
  } else {
    el.style.right = `${document.documentElement.clientWidth - rect.right}px`
    el.style.left = ''
  }
}

function onBeforeToggle(event: Event): void {
  if ((event as ToggleEvent).newState === 'open') place()
}

function onToggle(event: Event): void {
  open.value = (event as ToggleEvent).newState === 'open'
  if (open.value) window.addEventListener('resize', close)
  else window.removeEventListener('resize', close)
}

function select(item: MenuItem): void {
  close()
  item.action?.()
}

watch(() => route.fullPath, close)
onBeforeUnmount(() => window.removeEventListener('resize', close))
</script>

<template>
  <button
    ref="button"
    type="button"
    class="ep-menu__button"
    aria-haspopup="true"
    :aria-expanded="open"
    :aria-controls="id"
    @click="panel?.togglePopover()"
  >
    <span class="ep-menu__hidden">{{ label }}: </span><slot />
    <span class="ep-menu__caret" aria-hidden="true">▾</span>
  </button>
  <div :id="id" ref="panel" popover="auto" class="ep-menu__panel" @beforetoggle="onBeforeToggle" @toggle="onToggle">
    <ul class="ep-menu__list">
      <li v-for="item in items" :key="item.key">
        <RouterLink
          v-if="item.to"
          :to="item.to"
          class="ep-menu__item"
          :class="{ 'ep-menu__item--current': item.current }"
          :aria-current="item.current ? 'page' : undefined"
          @click="select(item)"
        >
          {{ item.label }}
        </RouterLink>
        <button v-else type="button" class="ep-menu__item" @click="select(item)">{{ item.label }}</button>
      </li>
      <li v-if="items.length === 0 && empty" class="ep-menu__empty">{{ empty }}</li>
    </ul>
  </div>
</template>

<style>
/*
 * Inside the shadow root: nothing here reaches the app, and the app's CSS does not reach in.
 * Inherited properties (font, color) and custom properties do come in from the app's header;
 * the button uses them, the list uses the platform's tokens.
 */
:host {
  display: inline-flex;
  align-items: center;
}

.ep-menu__button {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  font: inherit;
  padding: 0.25em 0.5em;
  border: 0;
  border-radius: var(--ep-radius, 6px);
  background: none;
  color: var(--ep-controls-color, inherit);
  cursor: pointer;
  white-space: nowrap;
}

.ep-menu__button:hover,
.ep-menu__button[aria-expanded='true'] {
  background: var(--ep-controls-hover, rgb(127 127 127 / 0.15));
}

.ep-menu__caret {
  opacity: 0.7;
  font-size: 0.8em;
}

.ep-menu__panel {
  position: fixed;
  inset: auto;
  margin: 0;
  min-width: 12rem;
  max-height: calc(100vh - 5rem);
  overflow: auto;
  padding: 0.25rem 0;
  border: 1px solid var(--ep-color-border, #e1e3e6);
  border-radius: var(--ep-radius, 6px);
  background: var(--ep-color-bg, #fff);
  color: var(--ep-color-text, #1f2328);
  font-family: var(--ep-font, system-ui, sans-serif);
  font-size: var(--ep-font-size, 0.9375rem);
  line-height: 1.5;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
}

.ep-menu__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ep-menu__item {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 0.5rem 1rem;
  border: 0;
  border-left: 3px solid transparent;
  background: none;
  font: inherit;
  text-align: left;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}

.ep-menu__item:hover {
  background: var(--ep-color-surface, #f7f7f8);
}

.ep-menu__item--current {
  border-left-color: var(--ep-color-accent, #c8221f);
  font-weight: 600;
}

.ep-menu__empty {
  padding: 0.5rem 1rem;
  color: var(--ep-color-muted, #5f6368);
}

.ep-menu__button:focus-visible,
.ep-menu__item:focus-visible {
  outline: 2px solid var(--ep-color-focus, #1a5fb4);
  outline-offset: -2px;
}

.ep-menu__hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
