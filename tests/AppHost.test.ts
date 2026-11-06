import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import AppHost from '../src/components/AppHost.vue'
import { MODULE_LOADER, type ModuleLoader } from '../src/components/moduleLoader'
import AppRouteView from '../src/views/AppRouteView.vue'
import { useAuthStore } from '../src/auth/store'
import { CONTRACT_VERSION, type MountContext } from '../src/contract'
import type { AppConfig } from '../src/config/validateApps'
import { setUnauthorizedHandler } from '../src/api/client'

const appConfig = (id: string, roles: string[] = []): AppConfig => ({
  id,
  label: id.toUpperCase(),
  entry: `/apps/${id}/embed.js`,
  apiBase: `/api/${id}`,
  roles,
})

const user = { name: 'Ada', roles: [], projects: ['schleiermacher'] }

/** A fake app module that records its lifecycle and renders into el. */
function fakeModule(id: string) {
  const log: string[] = []
  const contexts: MountContext[] = []
  const onKey = vi.fn()
  return {
    log,
    contexts,
    onKey,
    module: {
      contractVersion: CONTRACT_VERSION,
      mount(el: HTMLElement, ctx: MountContext) {
        log.push('mount')
        contexts.push(ctx)
        el.innerHTML = `<p class="fake">${id}</p>`
        window.addEventListener('keydown', onKey)
        return () => {
          log.push('unmount')
          window.removeEventListener('keydown', onKey)
          el.innerHTML = ''
        }
      },
    },
  }
}

let wrapper: VueWrapper | null = null

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

function mountHost(loader: ModuleLoader, onUnauthorized = vi.fn()) {
  wrapper = mount(AppHost, {
    props: { app: appConfig('zotero'), user, onUnauthorized },
    global: { provide: { [MODULE_LOADER as symbol]: loader } },
    attachTo: document.body,
  })
  return wrapper
}

describe('AppHost', () => {
  it('shows a loading state, then mounts the module with the context', async () => {
    const fake = fakeModule('zotero')
    let resolve!: (m: unknown) => void
    const loader = vi.fn(() => new Promise((r) => (resolve = r)))
    const onUnauthorized = vi.fn()
    const w = mountHost(loader, onUnauthorized)

    expect(w.find('[role="status"]').text()).toContain('Loading ZOTERO')
    expect(loader).toHaveBeenCalledWith('/apps/zotero/embed.js')

    resolve(fake.module)
    await flushPromises()
    expect(fake.log).toEqual(['mount'])
    expect(w.find('[role="status"]').exists()).toBe(false)
    expect(w.find('.fake').text()).toBe('zotero')

    const ctx = fake.contexts[0]!
    expect(ctx.routerBase).toBe('/zotero/')
    expect(ctx.apiBase).toBe('/api/zotero')
    expect(ctx.user).toEqual(user)
    ctx.onUnauthorized()
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it('unmounts the app and removes its DOM and listeners when destroyed', async () => {
    const fake = fakeModule('zotero')
    const w = mountHost(async () => fake.module)
    await flushPromises()
    w.unmount()
    wrapper = null
    expect(fake.log).toEqual(['mount', 'unmount'])
    expect(document.querySelector('.ep-apphost__app')).toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown'))
    expect(fake.onKey).not.toHaveBeenCalled()
  })

  it('does not mount if destroyed while the module is still loading', async () => {
    const fake = fakeModule('zotero')
    let resolve!: (m: unknown) => void
    const w = mountHost(() => new Promise((r) => (resolve = r)))
    w.unmount()
    wrapper = null
    resolve(fake.module)
    await flushPromises()
    expect(fake.log).toEqual([])
  })

  it('reports a contract version mismatch without mounting', async () => {
    const fake = fakeModule('zotero')
    const w = mountHost(async () => ({ ...fake.module, contractVersion: 99 }))
    await flushPromises()
    expect(fake.log).toEqual([])
    expect(w.find('[role="alert"]').text()).toContain(
      `ZOTERO is incompatible with this platform version (contract 99, expected ${CONTRACT_VERSION})`,
    )
    expect(w.find('button').exists()).toBe(false)
  })

  it('reports a missing contract version', async () => {
    const w = mountHost(async () => ({ mount: () => () => {} }))
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('(contract –, expected')
  })

  it('reports a module without mount function', async () => {
    const w = mountHost(async () => ({ contractVersion: CONTRACT_VERSION }))
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('does not export a mount function')
  })

  it('shows an unavailable message on import failure and retries with a fresh URL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = fakeModule('zotero')
    const loader = vi
      .fn<ModuleLoader>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(fake.module)
    const w = mountHost(loader)
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('ZOTERO is currently unavailable.')
    expect(fake.log).toEqual([])

    await w.find('button').trigger('click')
    await flushPromises()
    expect(loader).toHaveBeenLastCalledWith(expect.stringMatching(/\/apps\/zotero\/embed\.js\?platform-retry=1$/))
    expect(fake.log).toEqual(['mount'])
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.find('.fake').exists()).toBe(true)
  })

  it('handles a mount function that throws and cleans up its element', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const w = mountHost(async () => ({
      contractVersion: CONTRACT_VERSION,
      mount: () => {
        throw new Error('boom')
      },
    }))
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('ZOTERO failed to start.')
    expect(document.querySelector('.ep-apphost__app')).toBeNull()
  })
})

describe('AppHost inside the platform routes', () => {
  let router: Router
  let fakes: Record<string, ReturnType<typeof fakeModule>>

  async function setup(apps: AppConfig[], start: string) {
    fakes = Object.fromEntries(apps.map((a) => [a.id, fakeModule(a.id)]))
    router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        ...apps.map((app) => ({ path: `/${app.id}/:rest(.*)*`, component: AppRouteView, props: { app } })),
        { path: '/profile', component: defineComponent({ render: () => h('p', 'profile') }) },
      ],
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = user
    await router.push(start)
    wrapper = mount(
      defineComponent({ render: () => h(RouterView) }),
      {
        global: {
          plugins: [router, pinia],
          provide: { [MODULE_LOADER as symbol]: async (url: string) => fakes[url.split('/')[2]!]!.module },
        },
        attachTo: document.body,
      },
    )
    await flushPromises()
  }

  it('does not remount on navigation within the app', async () => {
    await setup([appConfig('mock'), appConfig('other')], '/mock/a')
    await router.push('/mock/b')
    await router.push('/mock')
    await flushPromises()
    expect(fakes.mock!.log).toEqual(['mount'])
  })

  it('fully unmounts the previous app when switching apps', async () => {
    await setup([appConfig('mock'), appConfig('other')], '/mock/a')
    await router.push('/other/x')
    await flushPromises()
    expect(fakes.mock!.log).toEqual(['mount', 'unmount'])
    expect(fakes.other!.log).toEqual(['mount'])
    expect(document.querySelectorAll('.ep-apphost__app')).toHaveLength(1)
    expect(document.querySelector('[data-app="mock"]')).toBeNull()

    await router.push('/mock/a')
    await flushPromises()
    expect(fakes.other!.log).toEqual(['mount', 'unmount'])
    expect(fakes.mock!.log).toEqual(['mount', 'unmount', 'mount'])
    // Exactly one listener from the currently mounted app.
    window.dispatchEvent(new KeyboardEvent('keydown'))
    expect(fakes.mock!.onKey).toHaveBeenCalledOnce()
    expect(fakes.other!.onKey).not.toHaveBeenCalled()
  })

  it('unmounts the app when leaving to a platform page', async () => {
    await setup([appConfig('mock')], '/mock')
    await router.push('/profile')
    await flushPromises()
    expect(fakes.mock!.log).toEqual(['mount', 'unmount'])
    expect(document.querySelector('.ep-apphost__app')).toBeNull()
  })

  it('remounts when the user changes', async () => {
    await setup([appConfig('mock')], '/mock')
    useAuthStore().user = { name: 'Grace', roles: [], projects: [] }
    await flushPromises()
    expect(fakes.mock!.log).toEqual(['mount', 'unmount', 'mount'])
    expect(fakes.mock!.contexts[1]!.user.name).toBe('Grace')
  })

  it('shows no-access instead of mounting an app the user may not use', async () => {
    await setup([appConfig('admin-only', ['admin'])], '/admin-only')
    expect(fakes['admin-only']!.log).toEqual([])
    expect(document.body.textContent).toContain('You do not have access to ADMIN-ONLY.')
  })

  it('passes the shared unauthorized handler to the app', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await setup([appConfig('mock')], '/mock')
    fakes.mock!.contexts[0]!.onUnauthorized()
    expect(handler).toHaveBeenCalledOnce()
    setUnauthorizedHandler(() => {})
  })
})
