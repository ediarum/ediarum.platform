/**
 * All calls to the auth backend (ediarum.webdav, Laravel). If the backend contract changes,
 * this is the only file to adapt.
 *
 * Assumed contract (see docs/auth-contract.md):
 *   GET  /api/auth/csrf-cookie                    → 204, sets XSRF-TOKEN cookie (Sanctum, prefix "api/auth")
 *   POST /api/auth/login    { email, password }   → 200 + session cookie; 401/422 on failure
 *   POST /api/auth/logout                          → 204
 *   GET  /api/auth/me                              → { name, email, roles, projects } or 401
 *   POST /api/auth/password { current_password, password, password_confirmation } → 204 or 422
 *   POST /api/auth/profile  { name }               → { name, email, roles, projects } or 422
 *   GET  /api/auth/projects                        → [{ slug, name }] or 401
 *   GET  /api/auth/verify   is for app backends (see docs/auth-contract.md) and never called here.
 */
import { api, UnauthorizedError, ApiError } from '../api/client'
import type { PlatformUser } from '../contract'

const BASE = '/api/auth'

/** Wrong credentials (401, or 422 from Laravel's LoginRequest). */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials')
    this.name = 'InvalidCredentialsError'
  }
}

/**
 * The logged-in user as the platform keeps it: what apps get (`PlatformUser`) plus the email, which
 * identifies the account and is shown read-only on the profile page. Apps don't get the email.
 */
export interface AccountUser extends PlatformUser {
  email?: string
}

function stringList(data: object, key: string): string[] {
  const value: unknown = (data as Record<string, unknown>)[key]
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function toUser(data: unknown, endpoint: string): AccountUser {
  if (typeof data === 'object' && data !== null && 'name' in data && typeof data.name === 'string') {
    const user: AccountUser = { name: data.name, roles: stringList(data, 'roles'), projects: stringList(data, 'projects') }
    if ('email' in data && typeof data.email === 'string') user.email = data.email
    return user
  }
  throw new ApiError(200, `Unexpected response from ${endpoint}`, data)
}

/** The current user, or null if not logged in. */
export async function fetchCurrentUser(): Promise<AccountUser | null> {
  try {
    return toUser(await api.get(`${BASE}/me`, { handleUnauthorized: false }), `${BASE}/me`)
  } catch (error) {
    if (error instanceof UnauthorizedError) return null
    throw error
  }
}

/** Logs in and returns the user. Throws {@link InvalidCredentialsError} on wrong credentials. */
export async function login(email: string, password: string): Promise<AccountUser> {
  try {
    await api.post(`${BASE}/login`, { email, password }, { handleUnauthorized: false })
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 422)) {
      throw new InvalidCredentialsError()
    }
    throw error
  }
  const user = await fetchCurrentUser()
  if (user === null) throw new ApiError(401, 'Login succeeded but the session was not established')
  return user
}

export async function logout(): Promise<void> {
  await api.post(`${BASE}/logout`, undefined, { handleUnauthorized: false })
}

/**
 * Changes the password. Throws a `ValidationError` whose `errors` are keyed by
 * {@link PASSWORD_FIELDS} values.
 */
export async function changePassword(current: string, next: string, confirmation: string): Promise<void> {
  await api.post(`${BASE}/password`, {
    [PASSWORD_FIELDS.current]: current,
    [PASSWORD_FIELDS.new]: next,
    [PASSWORD_FIELDS.confirmation]: confirmation,
  })
}

/**
 * Changes the user's display name and returns the updated user. Throws a `ValidationError`
 * keyed by `name`. The email can't be changed.
 */
export async function updateProfile(name: string): Promise<AccountUser> {
  return toUser(await api.post(`${BASE}/profile`, { name }), `${BASE}/profile`)
}

/** A project of the platform (see docs/auth-contract.md, "Projects"). */
export interface Project {
  slug: string
  name: string
}

/** The projects the user may access (all of them for admins), sorted by name. */
export async function fetchProjects(): Promise<Project[]> {
  const data = await api.get(`${BASE}/projects`)
  if (!Array.isArray(data)) throw new ApiError(200, `Unexpected response from ${BASE}/projects`, data)
  return data.filter(
    (p): p is Project => typeof p === 'object' && p !== null && typeof p.slug === 'string' && typeof p.name === 'string',
  )
}

/** Backend field names of the password form, used to map validation errors to inputs. */
export const PASSWORD_FIELDS = {
  current: 'current_password',
  new: 'password',
  confirmation: 'password_confirmation',
} as const
