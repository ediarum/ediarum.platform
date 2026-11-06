/**
 * Small fetch wrapper for the platform's own API calls.
 *
 * - same-origin credentials (Laravel session cookie), JSON in and out
 * - Laravel CSRF convention: the `XSRF-TOKEN` cookie is sent back as `X-XSRF-TOKEN` on every
 *   non-GET request; if the cookie is missing it is fetched from {@link CSRF_COOKIE_URL} first,
 *   and a 419 (token mismatch/expired) is retried once with a fresh token
 * - 401 calls the handler registered with {@link setUnauthorizedHandler} (unless disabled per request)
 * - failures are thrown as typed errors so views can show validation messages
 */

/** Endpoint that (re)sets the XSRF-TOKEN cookie. Sanctum's route with its prefix set to `api/auth`. */
export const CSRF_COOKIE_URL = '/api/auth/csrf-cookie'
const XSRF_COOKIE = 'XSRF-TOKEN'
const XSRF_HEADER = 'X-XSRF-TOKEN'

/** Any non-2xx response. `body` is the parsed JSON body, if there was one. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 401 response. */
export class UnauthorizedError extends ApiError {
  constructor(body?: unknown) {
    super(401, 'Unauthorized', body)
    this.name = 'UnauthorizedError'
  }
}

/** 422 response in Laravel's format: `{ message, errors: { field: [messages] } }`. */
export class ValidationError extends ApiError {
  constructor(
    message: string,
    public readonly errors: Record<string, string[]>,
    body?: unknown,
  ) {
    super(422, message, body)
    this.name = 'ValidationError'
  }
}

/** The request never got a response (offline, DNS, proxy down, …). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Network error', { cause })
    this.name = 'NetworkError'
  }
}

export interface RequestOptions {
  /** JSON-serializable request body. */
  body?: unknown
  /**
   * Whether a 401 triggers the global unauthorized handler (default true). Disable it for
   * calls where 401 is an expected answer, e.g. login with wrong credentials or the initial
   * "who am I" check.
   */
  handleUnauthorized?: boolean
}

let unauthorizedHandler: () => void = () => {}

/** Registers what happens on a 401 (clear user, go to login). Set once at startup. */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler
}

/**
 * Runs the registered unauthorized handler. Also passed to apps as `ctx.onUnauthorized`,
 * so a 401 from any backend is handled the same way.
 */
export function notifyUnauthorized(): void {
  unauthorizedHandler()
}

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      const value = rest.join('=')
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }
  }
  return null
}

async function send(method: string, url: string, body: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    // Makes Laravel answer auth failures with 401 JSON instead of a redirect to its login page.
    'X-Requested-With': 'XMLHttpRequest',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && method !== 'HEAD') {
    const token = readCookie(XSRF_COOKIE)
    if (token !== null) headers[XSRF_HEADER] = token
  }
  try {
    return await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new NetworkError(error)
  }
}

/** Fetches a fresh XSRF-TOKEN cookie. */
export async function refreshCsrfCookie(): Promise<void> {
  const response = await send('GET', CSRF_COOKIE_URL, undefined)
  if (!response.ok) throw new ApiError(response.status, 'Could not obtain CSRF cookie')
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function messageOf(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') {
    return body.message
  }
  return fallback
}

function validationErrorsOf(body: unknown): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  if (typeof body === 'object' && body !== null && 'errors' in body) {
    const raw = body.errors
    if (typeof raw === 'object' && raw !== null) {
      for (const [field, messages] of Object.entries(raw)) {
        if (Array.isArray(messages)) errors[field] = messages.filter((m): m is string => typeof m === 'string')
        else if (typeof messages === 'string') errors[field] = [messages]
      }
    }
  }
  return errors
}

export async function request<T = unknown>(method: string, url: string, options: RequestOptions = {}): Promise<T> {
  const { body, handleUnauthorized = true } = options
  const mutating = method !== 'GET' && method !== 'HEAD'

  if (mutating && readCookie(XSRF_COOKIE) === null) await refreshCsrfCookie()
  let response = await send(method, url, body)
  if (mutating && response.status === 419) {
    await refreshCsrfCookie()
    response = await send(method, url, body)
  }

  const data = await parseBody(response)
  if (response.ok) return data as T

  if (response.status === 401) {
    if (handleUnauthorized) notifyUnauthorized()
    throw new UnauthorizedError(data)
  }
  if (response.status === 422) {
    throw new ValidationError(messageOf(data, 'Validation failed'), validationErrorsOf(data), data)
  }
  throw new ApiError(response.status, messageOf(data, `HTTP ${response.status}`), data)
}

export const api = {
  get: <T = unknown>(url: string, options?: Omit<RequestOptions, 'body'>) => request<T>('GET', url, options),
  post: <T = unknown>(url: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', url, { ...options, body }),
}
