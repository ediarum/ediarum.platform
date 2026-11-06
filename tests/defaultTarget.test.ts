import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../src/config/validateApps'
import { defaultTarget, hasAccess, visibleApps } from '../src/router/defaultTarget'
import { getLastAppId, setLastAppId } from '../src/router/lastApp'

const app = (id: string, roles: string[] = []): AppConfig => ({
  id,
  label: id,
  entry: `/apps/${id}/embed.js`,
  apiBase: `/api/${id}`,
  roles,
})

const apps = [app('webdav', ['admin']), app('zotero'), app('index')]
const admin = { name: 'A', roles: ['admin'], projects: [] }
const user = { name: 'U', roles: [], projects: [] }

describe('hasAccess / visibleApps', () => {
  it('shows apps without roles to everyone', () => {
    expect(hasAccess(app('x'), user)).toBe(true)
  })

  it('requires at least one matching role', () => {
    expect(hasAccess(app('x', ['admin', 'editor']), { name: 'E', roles: ['editor'], projects: [] })).toBe(true)
    expect(hasAccess(app('x', ['admin']), user)).toBe(false)
    expect(hasAccess(app('x', ['admin']), null)).toBe(false)
  })

  it('filters the menu by role', () => {
    expect(visibleApps(apps, user).map((a) => a.id)).toEqual(['zotero', 'index'])
    expect(visibleApps(apps, admin).map((a) => a.id)).toEqual(['webdav', 'zotero', 'index'])
  })
})

describe('defaultTarget', () => {
  it('prefers a valid next', () => {
    expect(defaultTarget({ next: '/index/x', apps, user, lastAppId: 'zotero' })).toBe('/index/x')
    expect(defaultTarget({ next: '/profile', apps, user, lastAppId: 'zotero' })).toBe('/profile')
  })

  it('skips a next into an app the user cannot access', () => {
    expect(defaultTarget({ next: '/webdav/x', apps, user, lastAppId: null })).toBe('/zotero')
    expect(defaultTarget({ next: '/webdav/x', apps, user: admin, lastAppId: null })).toBe('/webdav/x')
  })

  it('then uses the last used app if still accessible', () => {
    expect(defaultTarget({ next: null, apps, user, lastAppId: 'index' })).toBe('/index')
    expect(defaultTarget({ next: null, apps, user, lastAppId: 'webdav' })).toBe('/zotero')
    expect(defaultTarget({ next: null, apps, user, lastAppId: 'removed' })).toBe('/zotero')
  })

  it('then the first accessible app', () => {
    expect(defaultTarget({ next: null, apps, user: admin, lastAppId: null })).toBe('/webdav')
    expect(defaultTarget({ next: null, apps, user, lastAppId: null })).toBe('/zotero')
  })

  it('falls back to the profile', () => {
    expect(defaultTarget({ next: null, apps: [], user, lastAppId: null })).toBe('/profile')
    expect(defaultTarget({ next: null, apps: [app('webdav', ['admin'])], user, lastAppId: 'webdav' })).toBe('/profile')
  })
})

describe('lastApp storage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('round-trips through localStorage', () => {
    setLastAppId('zotero')
    expect(getLastAppId()).toBe('zotero')
  })

  it('survives an unavailable localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => setLastAppId('zotero')).not.toThrow()
    expect(getLastAppId()).toBeNull()
  })
})
