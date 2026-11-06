/**
 * Platform router + an app router sharing window.history, as in production. The app router uses
 * a plain createWebHistory(routerBase), exactly like a real app would.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { createRouter, createWebHistory, RouterView, type Router } from 'vue-router'
import { appIdOf, createPlatformHistory, currentRouterPath } from '../src/router/history'

const Empty = defineComponent({ render: () => h('div') })
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

let platform: Router | null
let appRouter: Router | null
let apps: App[]

function startPlatform(base: string, url: string) {
  window.history.replaceState(null, '', url)
  platform = createRouter({
    history: createPlatformHistory({ base, appIds: ['mock', 'other'] }),
    routes: [
      { path: '/mock/:rest(.*)*', component: Empty },
      { path: '/other/:rest(.*)*', component: Empty },
      { path: '/profile', component: Empty },
    ],
  })
  const app = createApp({ render: () => h(RouterView) }).use(platform)
  app.mount(document.createElement('div'))
  apps.push(app)
  return platform.isReady()
}

function startApp(base: string) {
  appRouter = createRouter({
    history: createWebHistory(`${base}mock/`),
    routes: [
      { path: '/', component: Empty },
      { path: '/a', component: Empty },
      { path: '/b', component: Empty },
    ],
  })
  const app = createApp({ render: () => h(RouterView) }).use(appRouter)
  app.mount(document.createElement('div'))
  apps.push(app)
  return appRouter.isReady()
}

const url = () => window.location.pathname

beforeEach(() => {
  apps = []
  appRouter = null
  platform = null
})

afterEach(() => {
  apps.forEach((app) => app.unmount())
  appRouter?.options.history.destroy()
  platform?.options.history.destroy()
})

describe('helpers', () => {
  it('computes the router path relative to the base', () => {
    const loc = (pathname: string) => ({ pathname, search: '?q=1', hash: '#h' }) as Location
    expect(currentRouterPath('/', loc('/mock/a'))).toBe('/mock/a?q=1#h')
    expect(currentRouterPath('/', loc('/'))).toBe('/?q=1#h')
    expect(currentRouterPath('/sub/', loc('/sub/mock/a'))).toBe('/mock/a?q=1#h')
    expect(currentRouterPath('/sub/', loc('/sub'))).toBe('/?q=1#h')
    expect(currentRouterPath('/sub/', loc('/subx'))).toBe('/subx?q=1#h')
  })

  it('finds the app of a router path', () => {
    expect(appIdOf('/mock/a', ['mock'])).toBe('mock')
    expect(appIdOf('/mock', ['mock'])).toBe('mock')
    expect(appIdOf('/mock?x', ['mock'])).toBe('mock')
    expect(appIdOf('/mocky', ['mock'])).toBeNull()
    expect(appIdOf('/profile', ['mock'])).toBeNull()
  })
})

// Production serves the platform at the root; a subpath base must work too.
describe.each(['/', '/sub/'])('shared history (base %s)', (base) => {
  // Absolute URL of a platform-relative path.
  const at = (path: string) => `${base}${path.slice(1)}`

  it('keeps URLs intact when the platform navigates after the app did (back/forward)', async () => {
    await startPlatform(base, at('/mock/a'))
    await startApp(base)
    await appRouter!.push('/b')
    expect(url()).toBe(at('/mock/b'))

    await platform!.push('/profile')
    expect(url()).toBe(at('/profile'))

    window.history.back()
    await settle()
    expect(url()).toBe(at('/mock/b'))
    expect(platform!.currentRoute.value.fullPath).toBe('/mock/b')
    expect(appRouter!.currentRoute.value.fullPath).toBe('/b')

    window.history.back()
    await settle()
    expect(url()).toBe(at('/mock/a'))
    expect(appRouter!.currentRoute.value.fullPath).toBe('/a')

    window.history.forward()
    await settle()
    expect(url()).toBe(at('/mock/b'))
    expect(appRouter!.currentRoute.value.fullPath).toBe('/b')
  })

  it('lets the app router follow a platform navigation within the app (menu click)', async () => {
    await startPlatform(base, at('/mock/a'))
    await startApp(base)
    await appRouter!.push('/b')

    await platform!.push('/mock')
    await settle()
    expect(url()).toBe(at('/mock'))
    expect(appRouter!.currentRoute.value.fullPath).toBe('/')

    // The app keeps working afterwards, and history stays consistent.
    await appRouter!.push('/a')
    expect(url()).toBe(at('/mock/a'))
    window.history.back()
    await settle()
    // The app router normalizes its root entry to a trailing slash; both routers match it.
    expect([at('/mock'), at('/mock/')]).toContain(url())
    expect(appRouter!.currentRoute.value.fullPath).toBe('/')
    window.history.back()
    await settle()
    expect(url()).toBe(at('/mock/b'))
    expect(appRouter!.currentRoute.value.fullPath).toBe('/b')
  })

  it('does not notify the app when the platform leaves its area', async () => {
    await startPlatform(base, at('/mock/a'))
    await startApp(base)
    await platform!.push('/other/x')
    await settle()
    expect(url()).toBe(at('/other/x'))
    expect(appRouter!.currentRoute.value.fullPath).toBe('/a')
  })
})
