/**
 * In-memory implementation of the auth contract (docs/auth-contract.md) and of app backends that
 * use it, for `npm run dev`. Includes Laravel's CSRF behavior:
 *
 * - GET /api/auth/csrf-cookie sets a readable XSRF-TOKEN cookie
 * - every non-GET /api/auth request must echo it in X-XSRF-TOKEN, else 419
 *   (restarting the dev server forgets all tokens, which exercises the client's 419 retry)
 * - the session lives in an HttpOnly cookie and is regenerated on login
 *
 * /api/<id>/… stands in for an app backend: it runs the same check as GET /api/auth/verify
 * (401 without a session, 419 on writes without a valid token), otherwise answers with a JSON
 * echo including the X-User headers verify returned. Apps in `skipApps` (real backends set with
 * EDIARUM_DEV_BACKENDS) are passed on.
 *
 * Users: ada@example.org (no roles, member of "schleiermacher"), admin@example.org (role "admin",
 * no memberships, but admins may access every project); password "password".
 * Projects: schleiermacher, umfeldbriefe.
 *
 * Service side: GET /api/auth/service/projects with `Authorization: Bearer dev-service-token`
 * (MOCK_SERVICE_TOKEN).
 */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'

interface MockUser {
  email: string
  name: string
  roles: string[]
  projects: string[]
  password: string
}

interface MockProject {
  slug: string
  name: string
  repoUrl: string | null
  branch: string
  indexSourceOfTruth: 'xml' | 'app'
}

/** Bearer token of the mock's service-side endpoints. */
export const MOCK_SERVICE_TOKEN = 'dev-service-token'

type VerifyResult = { status: 204; user: MockUser } | { status: 401 | 419 }

const SESSION_COOKIE = 'ediarum_session'
const XSRF_COOKIE = 'XSRF-TOKEN'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key) cookies[key] = decodeURIComponent(rest.join('='))
  }
  return cookies
}

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' ? value : undefined
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.statusCode = status
  if (body === undefined) {
    res.end()
    return
  }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function validationError(res: ServerResponse, errors: Record<string, string[]>): void {
  send(res, 422, { message: Object.values(errors)[0]?.[0] ?? 'Invalid data.', errors })
}

const token = () => randomBytes(20).toString('hex')
const userPayload = (user: MockUser) => ({ name: user.name, email: user.email, roles: user.roles, projects: user.projects })

export interface MockBackendOptions {
  /** App ids whose /api/<id>/… requests are not answered here. */
  skipApps?: ReadonlySet<string>
}

export function createMockBackend({ skipApps = new Set() }: MockBackendOptions = {}): Connect.NextHandleFunction {
  const users: MockUser[] = [
    { email: 'ada@example.org', name: 'Ada Lovelace', roles: [], projects: ['schleiermacher'], password: 'password' },
    { email: 'admin@example.org', name: 'Admin', roles: ['admin'], projects: [], password: 'password' },
  ]
  const projects: MockProject[] = [
    {
      slug: 'schleiermacher',
      name: 'Schleiermacher in Berlin',
      repoUrl: 'https://gitlab.example.org/telota/schleiermacher-data.git',
      branch: 'main',
      indexSourceOfTruth: 'xml',
    },
    {
      slug: 'umfeldbriefe',
      name: 'Umfeldbriefe',
      repoUrl: 'https://gitlab.example.org/telota/umfeldbriefe-data.git',
      branch: 'develop',
      indexSourceOfTruth: 'app',
    },
  ]
  const sessions = new Map<string, MockUser>()
  const xsrfTokens = new Set<string>()

  function setXsrfCookie(): string[] {
    const value = token()
    xsrfTokens.add(value)
    return [`${XSRF_COOKIE}=${value}; Path=/; SameSite=Lax`]
  }

  function csrfValid(cookies: Record<string, string>, header: string | undefined): boolean {
    return header !== undefined && header === cookies[XSRF_COOKIE] && xsrfTokens.has(header)
  }

  /** The contract's verify check, for a request with these cookies, method and token header. */
  function verify(cookieHeader: string | undefined, method: string, xsrfHeader: string | undefined): VerifyResult {
    const cookies = parseCookies(cookieHeader)
    const sessionId = cookies[SESSION_COOKIE]
    const user = sessionId ? sessions.get(sessionId) : undefined
    if (!user) return { status: 401 }
    if (!SAFE_METHODS.has(method.toUpperCase()) && !csrfValid(cookies, xsrfHeader)) return { status: 419 }
    return { status: 204, user }
  }

  function sendVerifyFailure(res: ServerResponse, status: 401 | 419): void {
    send(res, status, { message: status === 401 ? 'Unauthenticated.' : 'CSRF token mismatch.' })
  }

  async function handleAuth(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET'
    const cookies = parseCookies(req.headers.cookie)
    const sessionId = cookies[SESSION_COOKIE]
    const user = sessionId ? sessions.get(sessionId) : undefined

    if (!SAFE_METHODS.has(method) && !csrfValid(cookies, headerOf(req, 'x-xsrf-token'))) {
      sendVerifyFailure(res, 419)
      return
    }

    if (path === '/api/auth/csrf-cookie' && method === 'GET') {
      res.setHeader('Set-Cookie', setXsrfCookie())
      send(res, 204)
      return
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const { email, password } = await readJson(req)
      if (typeof email !== 'string' || email === '' || typeof password !== 'string' || password === '') {
        validationError(res, { email: ['The email and password fields are required.'] })
        return
      }
      const found = users.find((u) => u.email === email && u.password === password)
      if (!found) {
        validationError(res, { email: ['These credentials do not match our records.'] })
        return
      }
      if (sessionId) sessions.delete(sessionId)
      const id = token()
      sessions.set(id, found)
      res.setHeader('Set-Cookie', [`${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`, ...setXsrfCookie()])
      send(res, 200, userPayload(found))
      return
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      if (sessionId) sessions.delete(sessionId)
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`)
      send(res, 204)
      return
    }

    if (path === '/api/auth/me' && method === 'GET') {
      if (!user) sendVerifyFailure(res, 401)
      else send(res, 200, userPayload(user))
      return
    }

    if (path === '/api/auth/password' && method === 'POST') {
      if (!user) {
        sendVerifyFailure(res, 401)
        return
      }
      const body = await readJson(req)
      const errors: Record<string, string[]> = {}
      if (body.current_password !== user.password) errors.current_password = ['The password is incorrect.']
      if (typeof body.password !== 'string' || body.password.length < 8) {
        errors.password = ['The password field must be at least 8 characters.']
      } else if (body.password !== body.password_confirmation) {
        errors.password = ['The password field confirmation does not match.']
      }
      if (Object.keys(errors).length > 0) validationError(res, errors)
      else {
        user.password = body.password as string
        send(res, 204)
      }
      return
    }

    if (path === '/api/auth/profile' && method === 'POST') {
      if (!user) {
        sendVerifyFailure(res, 401)
        return
      }
      const body = await readJson(req)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name === '') validationError(res, { name: ['The name field is required.'] })
      else if (name.length > 255) validationError(res, { name: ['The name field must not be greater than 255 characters.'] })
      else {
        user.name = name
        send(res, 200, userPayload(user))
      }
      return
    }

    if (path === '/api/auth/projects' && method === 'GET') {
      if (!user) sendVerifyFailure(res, 401)
      else {
        const visible = user.roles.includes('admin') ? projects : projects.filter((p) => user.projects.includes(p.slug))
        send(res, 200, [...visible].sort((a, b) => a.name.localeCompare(b.name)).map(({ slug, name }) => ({ slug, name })))
      }
      return
    }

    if (path === '/api/auth/service/projects' && method === 'GET') {
      if (headerOf(req, 'authorization') !== `Bearer ${MOCK_SERVICE_TOKEN}`) {
        send(res, 401)
        return
      }
      const registry = [...projects].sort((a, b) => a.slug.localeCompare(b.slug)).map((p) => ({
        slug: p.slug,
        name: p.name,
        repo_url: p.repoUrl,
        branch: p.branch,
        index_source_of_truth: p.indexSourceOfTruth,
      }))
      send(res, 200, registry)
      return
    }

    if (path === '/api/auth/verify' && method === 'GET') {
      const result = verify(req.headers.cookie, headerOf(req, 'x-original-method') ?? 'GET', headerOf(req, 'x-xsrf-token'))
      if (result.status !== 204) {
        sendVerifyFailure(res, result.status)
        return
      }
      res.setHeader('X-User', result.user.email)
      res.setHeader('X-User-Roles', result.user.roles.join(','))
      res.setHeader('X-User-Projects', result.user.projects.join(','))
      send(res, 204)
      return
    }

    send(res, 404, { message: 'Not found.' })
  }

  /** An app backend that checks every request like a real one would call verify. */
  function handleApp(req: IncomingMessage, res: ServerResponse, backend: string, path: string): void {
    const result = verify(req.headers.cookie, req.method ?? 'GET', headerOf(req, 'x-xsrf-token'))
    if (result.status !== 204) {
      sendVerifyFailure(res, result.status)
      return
    }
    send(res, 200, {
      backend,
      method: req.method,
      path,
      'X-User': result.user.email,
      'X-User-Roles': result.user.roles.join(','),
      'X-User-Projects': result.user.projects.join(','),
    })
  }

  return (req, res, next) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path.startsWith('/api/auth/')) {
      handleAuth(req, res, path).catch((error: unknown) => next(error))
      return
    }
    const appMatch = /^\/api\/([a-z0-9-]+)(\/.*)?$/.exec(path)
    if (appMatch && !skipApps.has(appMatch[1]!)) {
      handleApp(req, res, appMatch[1]!, appMatch[2] ?? '/')
      return
    }
    next()
  }
}
