import { describe, expect, it } from 'vitest'
import { validateApps } from '../src/config/validateApps'
import { ConfigError, loadApps } from '../src/config/loadApps'
import shipped from '../public/config/apps.json'

const valid = {
  id: 'zotero',
  label: 'Zotero',
  entry: '/apps/zotero/embed.js',
  apiBase: '/api/zotero',
  roles: [],
}

function errorsOf(data: unknown): string[] {
  const result = validateApps(data)
  return result.ok ? [] : result.errors
}

describe('validateApps', () => {
  it('accepts a valid list', () => {
    expect(validateApps([valid])).toEqual({ ok: true, apps: [valid] })
  })

  it('accepts the shipped apps.json', () => {
    expect(validateApps(shipped).ok).toBe(true)
  })

  it('accepts an empty list', () => {
    expect(validateApps([])).toEqual({ ok: true, apps: [] })
  })

  it('defaults missing roles to [] and normalizes label and apiBase', () => {
    const { roles: _roles, ...noRoles } = valid
    const result = validateApps([{ ...noRoles, label: ' Zotero ', apiBase: '/api/zotero/' }])
    expect(result).toEqual({ ok: true, apps: [valid] })
  })

  it('accepts http(s) URLs for entry and apiBase', () => {
    expect(validateApps([{ ...valid, entry: 'https://cdn.example.org/embed.js', apiBase: 'http://x.example/api' }]).ok).toBe(true)
  })

  it.each([null, {}, 'x', 42])('rejects a non-array root (%j)', (data) => {
    expect(errorsOf(data)).toHaveLength(1)
  })

  it('rejects non-object entries', () => {
    expect(errorsOf([valid, 'zotero'])[0]).toMatch(/App #2: must be an object/)
  })

  it.each(['', 'Zotero', 'zo tero', 'zo/tero', 'zotero_x', 7])('rejects invalid id %j', (id) => {
    expect(errorsOf([{ ...valid, id }]).join()).toMatch(/"id" must be/)
  })

  it.each(['login', 'profile', 'api', 'apps', 'config', 'assets'])('rejects reserved id %s', (id) => {
    expect(errorsOf([{ ...valid, id }]).join()).toMatch(/reserved/)
  })

  it('rejects duplicate ids', () => {
    expect(errorsOf([valid, valid]).join()).toMatch(/duplicate/)
  })

  it.each(['', '   ', 5, undefined])('rejects invalid label %j', (label) => {
    expect(errorsOf([{ ...valid, label }]).join()).toMatch(/"label"/)
  })

  it.each(['', 'embed.js', './embed.js', '//evil.example/embed.js', 'javascript:alert(1)', undefined])(
    'rejects invalid entry %j',
    (entry) => {
      expect(errorsOf([{ ...valid, entry }]).join()).toMatch(/"entry"/)
    },
  )

  it.each(['', 'api/zotero', '//evil.example', undefined])('rejects invalid apiBase %j', (apiBase) => {
    expect(errorsOf([{ ...valid, apiBase }]).join()).toMatch(/"apiBase"/)
  })

  it.each(['admin', [1], [''], null])('rejects invalid roles %j', (roles) => {
    expect(errorsOf([{ ...valid, roles }]).join()).toMatch(/"roles"/)
  })

  it('rejects unknown keys (catches typos)', () => {
    expect(errorsOf([{ ...valid, role: ['admin'] }]).join()).toMatch(/unknown key "role"/)
  })

  it('collects errors from all apps', () => {
    expect(errorsOf([{ ...valid, id: 'X' }, { ...valid, id: 'b', label: '' }])).toHaveLength(2)
  })
})

describe('loadApps', () => {
  const respond = (body: string, status = 200) => async () => new Response(body, { status })

  it('returns validated apps', async () => {
    await expect(loadApps('/c.json', respond(JSON.stringify([valid])))).resolves.toEqual([valid])
  })

  it('reports a missing file', async () => {
    await expect(loadApps('/c.json', respond('nope', 404))).rejects.toThrow(/HTTP 404/)
  })

  it('reports invalid JSON (e.g. an HTML fallback page)', async () => {
    await expect(loadApps('/c.json', respond('<!doctype html>'))).rejects.toThrow(/not valid JSON/)
  })

  it('reports network errors', async () => {
    const failing = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch')
    }
    await expect(loadApps('/c.json', failing)).rejects.toBeInstanceOf(ConfigError)
  })

  it('reports validation errors with details', async () => {
    const error = await loadApps('/c.json', respond('[{"id":"X"}]')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConfigError)
    expect((error as ConfigError).details.length).toBeGreaterThan(1)
  })
})
