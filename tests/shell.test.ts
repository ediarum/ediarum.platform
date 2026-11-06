/**
 * The platform shell: route guard, redirects after login, 401 handling, login/profile views and
 * the platform controls (top bar or inside an app). Uses the real router, store and API client with a fake fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, type Router } from 'vue-router'
import App from '../src/App.vue'
import { notifyUnauthorized } from '../src/api/client'
import type { AccountUser } from '../src/auth/api'
import { useAuthStore } from '../src/auth/store'
import { MODULE_LOADER } from '../src/components/moduleLoader'
import { APPS } from '../src/config/loadApps'
import type { AppConfig } from '../src/config/validateApps'
import { CONTRACT_VERSION, type PlatformUser } from '../src/contract'
import { installPlatformControls } from '../src/controls'
import { createPlatformRouter, installUnauthorizedHandler } from '../src/router'

const apps: AppConfig[] = [
  { id: 'mock', label: 'Mock', entry: '/apps/mock/embed.js', apiBase: '/api/mock', roles: [] },
  { id: 'admin', label: 'Admin', entry: '/apps/admin/embed.js', apiBase: '/api/admin', roles: ['admin'] },
]
const ada: PlatformUser = { name: 'Ada', roles: [], projects: [] }

type Handler = (init: RequestInit) => { status: number; body?: unknown }
let routes: Record<string, Handler>
let calls: { method: string; url: string; body: unknown }[]

function fakeFetch(url: string, init: RequestInit = {}) {
  const method = init.method ?? 'GET'
  calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined })
  const handler = routes[`${method} ${url}`]
  const { status, body } = handler ? handler(init) : { status: 404 }
  return Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

let router: Router
let pinia: Pinia
let wrapper: VueWrapper | null = null
const unmountApp = vi.fn()
/** What the fake app renders into its element; `<ediarum-user-menu>` makes it host the controls. */
let appHtml: string
/** Module loading waits for this; replace it to keep an app in its loading state. */
let moduleReady: Promise<void>

beforeEach(() => {
  calls = []
  routes = {}
  unmountApp.mockClear()
  appHtml = 'mock app'
  moduleReady = Promise.resolve()
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  document.cookie = 'XSRF-TOKEN=token'
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function start(path: string, user: AccountUser | null = null) {
  useAuthStore().user = user
  router = createPlatformRouter(apps, createMemoryHistory('/'))
  installUnauthorizedHandler(router, '/')
  installPlatformControls({ pinia, router, apps })
  await router.push(path)
  wrapper = mount(App, {
    global: {
      plugins: [router, pinia],
      provide: {
        [APPS as symbol]: apps,
        [MODULE_LOADER as symbol]: async () => {
          await moduleReady
          return {
          contractVersion: CONTRACT_VERSION,
          mount: (el: HTMLElement) => {
            el.innerHTML = appHtml
            return () => {
              el.innerHTML = ''
              unmountApp()
            }
          },
          }
        },
      },
    },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

async function fillPasswords(w: VueWrapper, current: string, next: string, confirmation: string) {
  await w.find('#pw-current').setValue(current)
  await w.find('#pw-new').setValue(next)
  await w.find('#pw-confirmation').setValue(confirmation)
}

/**
 * jsdom has no Popover API. Enough of it for the menus: show/hide/toggle with the
 * `beforetoggle` and `toggle` events, and `:popover-open` replaced by `popoverOpen`.
 */
const popoverOpen = new WeakSet<HTMLElement>()
function setPopover(el: HTMLElement, open: boolean): void {
  if (popoverOpen.has(el) === open) return
  const newState = open ? 'open' : 'closed'
  el.dispatchEvent(Object.assign(new Event('beforetoggle'), { newState }))
  if (open) popoverOpen.add(el)
  else popoverOpen.delete(el)
  el.dispatchEvent(Object.assign(new Event('toggle'), { newState }))
}
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) { setPopover(this, true) },
  hidePopover(this: HTMLElement) { setPopover(this, false) },
  togglePopover(this: HTMLElement) { setPopover(this, !popoverOpen.has(this)) },
})

/** The shadow root of the platform control `tag`, inside `scope`. */
function control(tag: 'ediarum-home' | 'ediarum-user-menu', scope: ParentNode = document): ShadowRoot {
  const root = scope.querySelector(tag)?.shadowRoot
  if (!root) throw new Error(`no ${tag} in scope`)
  return root
}
const menuButton = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('.ep-menu__button')!
const menuPanel = (root: ShadowRoot) => root.querySelector<HTMLElement>('.ep-menu__panel')!
const menuItems = (root: ShadowRoot) => [...root.querySelectorAll<HTMLElement>('.ep-menu__item')]
const topBar = () => document.querySelector('header.ep-topbar')

async function click(el: HTMLElement): Promise<void> {
  el.click()
  await flushPromises()
}

const passwordForm = (w: VueWrapper) => w.find('#password-form')
const nameForm = (w: VueWrapper) => w.find('#name-form')

describe('route guard', () => {
  it('sends logged-out users to /login with the original path as next', async () => {
    await start('/mock/deep/path?x=1')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.next).toBe('/mock/deep/path?x=1')
  })

  it('sends logged-out users from / to /login without next', async () => {
    await start('/')
    expect(router.currentRoute.value.fullPath).toBe('/login')
  })

  it('shows not-found for unknown paths without requiring login', async () => {
    const w = await start('/nope')
    expect(router.currentRoute.value.name).toBe('not-found')
    expect(w.text()).toContain('Page not found')
  })

  it('redirects / to the first accessible app, or to the last used one', async () => {
    await start('/', ada)
    expect(router.currentRoute.value.fullPath).toBe('/mock')

    await router.push('/profile')
    useAuthStore().user = { name: 'Root', roles: ['admin'], projects: [] }
    window.localStorage.setItem('ediarum-platform:last-app', 'admin')
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/admin')
  })

  it('redirects logged-in users away from /login to a valid next', async () => {
    await start('/login?next=/profile', ada)
    expect(router.currentRoute.value.fullPath).toBe('/profile')
  })

  it.each(['//evil.example', 'https://evil.example', '/\\evil.example', '/nope', '/login'])(
    'ignores the invalid next %s',
    async (next) => {
      await start(`/login?next=${encodeURIComponent(next)}`, ada)
      expect(router.currentRoute.value.fullPath).toBe('/mock')
    },
  )

  it('skips a next into an app the user may not use', async () => {
    await start('/login?next=/admin/x', ada)
    expect(router.currentRoute.value.fullPath).toBe('/mock')
  })
})

describe('login', () => {
  beforeEach(() => {
    routes['GET /api/auth/me'] = () => ({ status: 200, body: ada })
  })

  it('focuses the email field', async () => {
    const w = await start('/login')
    expect(document.activeElement).toBe(w.find('#login-email').element)
  })

  it('logs in and returns to next', async () => {
    routes['POST /api/auth/login'] = () => ({ status: 200 })
    const w = await start('/login?next=/mock/deep')
    await w.find('#login-email').setValue('ada@example.org')
    await w.find('#login-password').setValue('secret')
    await w.find('form').trigger('submit')
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeDefined()
    await flushPromises()

    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'ada@example.org', password: 'secret' },
    })
    expect(useAuthStore().user).toEqual(ada)
    expect(router.currentRoute.value.fullPath).toBe('/mock/deep')
    expect(w.text()).toContain('mock app')
  })

  it('shows an inline error on wrong credentials and stays on the page', async () => {
    routes['POST /api/auth/login'] = () => ({ status: 422, body: { message: 'x', errors: { email: ['x'] } } })
    const w = await start('/login')
    await w.find('#login-email').setValue('ada@example.org')
    await w.find('#login-password').setValue('wrong')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(w.find('[role="alert"]').text()).toBe('Email or password is incorrect.')
    expect(w.find('#login-email').attributes('aria-invalid')).toBe('true')
    expect((w.find('#login-password').element as HTMLInputElement).value).toBe('')
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeUndefined()
    expect(router.currentRoute.value.name).toBe('login')
  })
})

describe('401 handling', () => {
  it('unmounts the app and goes to login with the current URL, then back after login', async () => {
    const w = await start('/mock', ada)
    expect(w.text()).toContain('mock app')

    // The app navigated internally; the platform route did not change, the URL did.
    window.history.replaceState(null, '', '/mock/item/7?tab=2')
    notifyUnauthorized()
    await flushPromises()

    expect(unmountApp).toHaveBeenCalledOnce()
    expect(useAuthStore().user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.next).toBe('/mock/item/7?tab=2')
    expect(w.find('header').exists()).toBe(false)
    expect(w.text()).toContain('Your session has ended.')

    routes['POST /api/auth/login'] = () => ({ status: 200 })
    routes['GET /api/auth/me'] = () => ({ status: 200, body: ada })
    await w.find('#login-email').setValue('ada@example.org')
    await w.find('#login-password').setValue('secret')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/mock/item/7?tab=2')
    expect(w.text()).not.toContain('Your session has ended.')
  })

  it('does not navigate again when already on the login page', async () => {
    await start('/login')
    const push = vi.spyOn(router, 'push')
    notifyUnauthorized()
    expect(push).not.toHaveBeenCalled()
  })

  it('a 401 from a platform API call triggers it', async () => {
    routes['POST /api/auth/password'] = () => ({ status: 401 })
    const w = await start('/profile', ada)
    await fillPasswords(w, 'pw', 'pw', 'pw')
    await passwordForm(w).trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.next).toBe('/')
  })
})

describe('profile', () => {
  it('shows the name for editing, the email read-only, and the roles', async () => {
    const w = await start('/profile', { name: 'Root', email: 'root@example.org', roles: ['admin', 'editor'], projects: [] })
    expect((w.find('#profile-name').element as HTMLInputElement).value).toBe('Root')
    expect(w.find('dl').text()).toContain('root@example.org')
    expect(w.find('dl').text()).toContain('cannot be changed')
    expect(w.find('dl').text()).toContain('admin, editor')
    expect(w.find('input[type="email"]').exists()).toBe(false)
  })

  it('omits the email when the provider sent none', async () => {
    const w = await start('/profile', ada)
    expect(w.find('dl').text()).not.toContain('Email')
  })

  it('checks that the new passwords match before sending', async () => {
    const w = await start('/profile', ada)
    await fillPasswords(w, 'old', 'new-one', 'new-two')
    await passwordForm(w).trigger('submit')
    await flushPromises()
    expect(w.find('#pw-confirmation-error').text()).toBe('The new passwords do not match.')
    expect(calls.some((c) => c.url === '/api/auth/password')).toBe(false)
  })

  it('shows server validation errors next to their fields', async () => {
    routes['POST /api/auth/password'] = () => ({
      status: 422,
      body: {
        message: 'invalid',
        errors: { current_password: ['The password is incorrect.'], password: ['Too short.'] },
      },
    })
    const w = await start('/profile', ada)
    await fillPasswords(w, 'old', 'new', 'new')
    await passwordForm(w).trigger('submit')
    await flushPromises()

    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/auth/password',
      body: { current_password: 'old', password: 'new', password_confirmation: 'new' },
    })
    expect(w.find('#pw-current-error').text()).toBe('The password is incorrect.')
    expect(w.find('#pw-new-error').text()).toBe('Too short.')
    expect(w.find('#pw-current').attributes('aria-invalid')).toBe('true')
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('confirms success and clears the form', async () => {
    routes['POST /api/auth/password'] = () => ({ status: 204 })
    const w = await start('/profile', ada)
    await fillPasswords(w, 'pw', 'pw', 'pw')
    await passwordForm(w).trigger('submit')
    await flushPromises()
    expect(w.find('[role="status"]').text()).toBe('Your password has been changed.')
    expect((w.find('#pw-new').element as HTMLInputElement).value).toBe('')
  })
})

describe('profile projects', () => {
  const projectsRow = (w: VueWrapper) => {
    const dts = w.findAll('dl dt')
    const index = dts.findIndex((dt) => dt.text() === 'Projects')
    return w.findAll('dl dd')[index]!.text()
  }

  it('shows the names of the user\'s projects', async () => {
    routes['GET /api/auth/projects'] = () => ({
      status: 200,
      body: [{ slug: 'schleiermacher', name: 'Schleiermacher in Berlin' }],
    })
    const w = await start('/profile', { ...ada, projects: ['schleiermacher'] })
    expect(projectsRow(w)).toBe('Schleiermacher in Berlin')
  })

  it('falls back to the slugs if the names cannot be loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    routes['GET /api/auth/projects'] = () => ({ status: 500 })
    const w = await start('/profile', { ...ada, projects: ['schleiermacher'] })
    expect(projectsRow(w)).toBe('schleiermacher')
  })

  it('says "all projects" for admins and "none" without memberships, without loading names', async () => {
    let w = await start('/profile', { name: 'Root', roles: ['admin'], projects: [] })
    expect(projectsRow(w)).toBe('all projects (administrator)')
    w.unmount()
    wrapper = null
    w = await start('/profile', ada)
    expect(projectsRow(w)).toBe('none')
    expect(calls.some((c) => c.url === '/api/auth/projects')).toBe(false)
  })
})

describe('profile name', () => {
  it('prefills the name and saves it, updating the top bar', async () => {
    routes['POST /api/auth/profile'] = () => ({
      status: 200,
      body: { name: 'Ada King', email: 'ada@example.org', roles: [], projects: [] },
    })
    const w = await start('/profile', ada)
    expect((w.find('#profile-name').element as HTMLInputElement).value).toBe('Ada')
    await w.find('#profile-name').setValue('  Ada King ')
    await nameForm(w).trigger('submit')
    await flushPromises()

    expect(calls).toContainEqual({ method: 'POST', url: '/api/auth/profile', body: { name: 'Ada King' } })
    expect(useAuthStore().user).toEqual({ name: 'Ada King', email: 'ada@example.org', roles: [], projects: [] })
    expect(menuButton(control('ediarum-user-menu')).textContent).toContain('Ada King')
    expect(w.find('[role="status"]').text()).toBe('Your name has been saved.')
  })

  it('does not send an empty name', async () => {
    const w = await start('/profile', ada)
    await w.find('#profile-name').setValue('   ')
    await nameForm(w).trigger('submit')
    await flushPromises()
    expect(w.find('#profile-name-error').text()).toBe('Please enter a name.')
    expect(calls.some((c) => c.url === '/api/auth/profile')).toBe(false)
  })

  it('shows server validation errors next to the field', async () => {
    routes['POST /api/auth/profile'] = () => ({
      status: 422,
      body: { message: 'invalid', errors: { name: ['Too long.'] } },
    })
    const w = await start('/profile', ada)
    await w.find('#profile-name').setValue('x')
    await nameForm(w).trigger('submit')
    await flushPromises()
    expect(w.find('#profile-name-error').text()).toBe('Too long.')
    expect(w.find('#profile-name').attributes('aria-invalid')).toBe('true')
    expect(useAuthStore().user).toEqual(ada)
  })
})

describe('top bar', () => {
  it('shows the app menu with only accessible apps and marks the active one', async () => {
    await start('/mock/some/where', ada)
    const home = control('ediarum-home', topBar()!)
    expect(menuButton(home).textContent).toContain('ediarum')
    const links = menuItems(home)
    expect(links.map((a) => a.textContent!.trim())).toEqual(['Mock'])
    expect(links[0]!.getAttribute('aria-current')).toBe('page')
    expect(links[0]!.getAttribute('href')).toBe('/mock')

    await router.push('/profile')
    await flushPromises()
    expect(menuItems(home)[0]!.getAttribute('aria-current')).toBeNull()
  })

  it('shows admin apps to admins', async () => {
    await start('/profile', { name: 'Root', roles: ['admin'], projects: [] })
    expect(menuItems(control('ediarum-home')).map((a) => a.textContent!.trim())).toEqual(['Mock', 'Admin'])
  })

  it('opens the user menu, and closes it after choosing an item', async () => {
    await start('/mock', ada)
    const user = control('ediarum-user-menu')
    const button = menuButton(user)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe(menuPanel(user).id)
    await click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(popoverOpen.has(menuPanel(user))).toBe(true)

    await click(menuItems(user)[0]!)
    expect(router.currentRoute.value.path).toBe('/profile')
    expect(popoverOpen.has(menuPanel(user))).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('logs out, unmounts the app and goes to login with next', async () => {
    routes['POST /api/auth/logout'] = () => ({ status: 204 })
    window.history.replaceState(null, '', '/mock/a')
    const w = await start('/mock/a', ada)
    const user = control('ediarum-user-menu')
    await click(menuButton(user))
    await click(menuItems(user)[1]!)

    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/auth/logout')).toBe(true)
    expect(unmountApp).toHaveBeenCalledOnce()
    expect(useAuthStore().user).toBeNull()
    expect(router.currentRoute.value.fullPath).toBe('/login?next=/mock/a')
    expect(w.text()).not.toContain('Your session has ended.')
  })
})

describe('platform controls inside an app', () => {
  const appHeader = '<header><ediarum-home></ediarum-home><ediarum-user-menu></ediarum-user-menu></header>'

  it('hides the top bar while the app shows the controls, and shows it on platform pages', async () => {
    appHtml = appHeader
    await start('/mock', ada)
    expect(topBar()).toBeNull()
    const app = document.querySelector<HTMLElement>('[data-app="mock"]')!
    expect(menuButton(control('ediarum-user-menu', app)).textContent).toContain('Ada')

    await router.push('/profile')
    await flushPromises()
    expect(topBar()).not.toBeNull()
  })

  it('works like the top bar: the app menu switches apps', async () => {
    appHtml = appHeader
    await start('/mock/a', { name: 'Root', roles: ['admin'], projects: [] })
    const home = control('ediarum-home', document.querySelector('[data-app="mock"]')!)
    await click(menuButton(home))
    await click(menuItems(home)[1]!)
    expect(router.currentRoute.value.path).toBe('/admin')
    expect(unmountApp).toHaveBeenCalledOnce()
  })

  it('keeps the top bar hidden while reloading an app that showed the controls before', async () => {
    appHtml = appHeader
    await start('/mock', ada)
    await router.push('/profile')
    await flushPromises()
    expect(topBar()).not.toBeNull()

    let load!: () => void
    moduleReady = new Promise((resolve) => (load = resolve))
    await router.push('/mock')
    await flushPromises()
    expect(document.body.textContent).toContain('Loading Mock')
    expect(topBar()).toBeNull()
    load()
    await flushPromises()
    expect(topBar()).toBeNull()
  })

  it('shows the top bar if the app removes the user menu while mounted', async () => {
    appHtml = appHeader
    await start('/mock', ada)
    expect(topBar()).toBeNull()
    document.querySelector('[data-app="mock"] ediarum-user-menu')!.remove()
    await flushPromises()
    expect(topBar()).not.toBeNull()
  })

  it('shows the top bar for apps without the controls', async () => {
    await start('/mock', ada)
    expect(document.querySelector('[data-app="mock"]')!.textContent).toBe('mock app')
    expect(topBar()).not.toBeNull()
  })
})
