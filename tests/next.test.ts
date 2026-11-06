import { describe, expect, it } from 'vitest'
import { validateNext } from '../src/router/next'

const known = (path: string) => /^\/(profile|mock(\/.*)?)(\?.*)?$/.test(path)

describe('validateNext', () => {
  it.each(['/profile', '/mock', '/mock/a/b', '/mock/a?x=1', '/mock/a%20b'])('accepts internal path %s', (next) => {
    expect(validateNext(next, known)).toBe(next)
  })

  it.each([
    ['protocol-relative', '//evil.example'],
    ['protocol-relative with path', '//evil.example/mock'],
    ['absolute URL', 'https://evil.example/mock'],
    ['scheme inside path', '/mock/https://evil.example'],
    ['javascript URL', 'javascript:alert(1)'],
    ['relative path', 'mock/a'],
    ['backslash', '/\\evil.example'],
    ['backslash only', '\\\\evil.example'],
    ['encoded slash', '/%2Fevil.example'],
    ['encoded backslash', '/%5Cevil.example'],
    ['encoded scheme', '/mock/https%3A%2F%2Fevil.example'],
    ['tab trick', '/\t/evil.example'],
    ['newline', '/mock\n'],
    ['malformed encoding', '/mock/%E0%A4%A'],
    ['empty', ''],
    ['unknown route', '/nope'],
  ])('rejects %s', (_label, next) => {
    expect(validateNext(next, known)).toBeNull()
  })

  it.each([undefined, null, 42, ['/profile'], {}])('rejects non-string %j', (next) => {
    expect(validateNext(next, known)).toBeNull()
  })
})
