import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  api,
  ApiError,
  CSRF_COOKIE_URL,
  NetworkError,
  readCookie,
  setUnauthorizedHandler,
  UnauthorizedError,
  ValidationError,
} from '../src/api/client'

type Call = { url: string; method: string; headers: Record<string, string>; body?: string }

let calls: Call[]
let responses: Array<(call: Call) => Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function clearCookies(): void {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

beforeEach(() => {
  calls = []
  responses = []
  clearCookies()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call: Call = {
        url,
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
        body: init.body as string | undefined,
      }
      calls.push(call)
      const next = responses.shift()
      if (!next) throw new Error(`unexpected fetch ${call.method} ${url}`)
      return next(call)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(() => {})
})

describe('readCookie', () => {
  it('reads and decodes a cookie', () => {
    document.cookie = 'XSRF-TOKEN=abc%3D%3D'
    document.cookie = 'other=1'
    expect(readCookie('XSRF-TOKEN')).toBe('abc==')
    expect(readCookie('missing')).toBeNull()
  })
})

describe('api client', () => {
  it('sends JSON with same-origin credentials and parses JSON', async () => {
    responses.push(() => json({ ok: true }))
    await expect(api.get('/api/x')).resolves.toEqual({ ok: true })
    const init = vi.mocked(fetch).mock.calls[0]![1]!
    expect(init.credentials).toBe('same-origin')
    expect(calls[0]!.headers.Accept).toBe('application/json')
  })

  it('does not send the XSRF header on GET', async () => {
    document.cookie = 'XSRF-TOKEN=tok'
    responses.push(() => json({}))
    await api.get('/api/x')
    expect(calls[0]!.headers['X-XSRF-TOKEN']).toBeUndefined()
  })

  it('sends the decoded XSRF cookie as header on non-GET', async () => {
    document.cookie = 'XSRF-TOKEN=tok%3D'
    responses.push(() => new Response(null, { status: 204 }))
    await expect(api.post('/api/x', { a: 1 })).resolves.toBeUndefined()
    expect(calls[0]!.headers['X-XSRF-TOKEN']).toBe('tok=')
    expect(calls[0]!.headers['Content-Type']).toBe('application/json')
    expect(calls[0]!.body).toBe('{"a":1}')
  })

  it('fetches the CSRF cookie first if it is missing', async () => {
    responses.push(() => {
      document.cookie = 'XSRF-TOKEN=fresh'
      return new Response(null, { status: 204 })
    })
    responses.push(() => json({}))
    await api.post('/api/x')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${CSRF_COOKIE_URL}`, 'POST /api/x'])
    expect(calls[1]!.headers['X-XSRF-TOKEN']).toBe('fresh')
  })

  it('retries once with a fresh token on 419', async () => {
    document.cookie = 'XSRF-TOKEN=stale'
    responses.push(() => json({ message: 'CSRF token mismatch.' }, 419))
    responses.push(() => {
      document.cookie = 'XSRF-TOKEN=fresh'
      return new Response(null, { status: 204 })
    })
    responses.push(() => json({ done: true }))
    await expect(api.post('/api/x')).resolves.toEqual({ done: true })
    expect(calls[2]!.headers['X-XSRF-TOKEN']).toBe('fresh')
  })

  it('calls the unauthorized handler and throws on 401', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    responses.push(() => json({ message: 'Unauthenticated.' }, 401))
    await expect(api.get('/api/x')).rejects.toBeInstanceOf(UnauthorizedError)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('does not call the unauthorized handler when disabled per request', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    responses.push(() => json({}, 401))
    await expect(api.get('/api/x', { handleUnauthorized: false })).rejects.toBeInstanceOf(UnauthorizedError)
    expect(handler).not.toHaveBeenCalled()
  })

  it('throws a ValidationError with field messages on 422', async () => {
    document.cookie = 'XSRF-TOKEN=tok'
    responses.push(() => json({ message: 'Invalid', errors: { password: ['Too short.'], x: 'single' } }, 422))
    const error = await api.post('/api/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).errors).toEqual({ password: ['Too short.'], x: ['single'] })
    expect((error as ValidationError).message).toBe('Invalid')
  })

  it('throws an ApiError with status for other failures', async () => {
    responses.push(() => new Response('boom', { status: 500 }))
    const error = await api.get('/api/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(500)
  })

  it('throws a NetworkError if fetch fails', async () => {
    responses.push(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(api.get('/api/x')).rejects.toBeInstanceOf(NetworkError)
  })
})
