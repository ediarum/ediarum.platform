export interface AppConfig {
  /** URL segment (`/<id>/…`), `[a-z0-9-]+`. */
  id: string
  /** Menu text. */
  label: string
  /** URL of the app's ES module. */
  entry: string
  /** Base URL of the app's backend, passed to the app (no trailing slash). */
  apiBase: string
  /** If non-empty, only users with at least one of these roles see the app. */
  roles: string[]
}

export type ValidationResult = { ok: true; apps: AppConfig[] } | { ok: false; errors: string[] }

/**
 * Ids that would collide with platform routes (`/login`, `/profile`) or with paths the
 * reverse proxy / platform container serve (`/api/`, `/apps/`, `/config/`, `/assets/`).
 */
export const RESERVED_IDS = ['login', 'profile', 'api', 'apps', 'config', 'assets'] as const

const ID_PATTERN = /^[a-z0-9-]+$/
const KNOWN_KEYS = new Set(['id', 'label', 'entry', 'apiBase', 'roles'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** Absolute path (`/x`, not `//x`) or http(s) URL. */
function isAbsoluteUrlOrPath(value: string): boolean {
  return (value.startsWith('/') && !value.startsWith('//')) || /^https?:\/\/[^/]/.test(value)
}

/** Validates the parsed content of `apps.json`. Collects all errors instead of stopping at the first. */
export function validateApps(data: unknown): ValidationResult {
  if (!Array.isArray(data)) {
    return { ok: false, errors: ['The file must contain a JSON array of apps.'] }
  }

  const errors: string[] = []
  const apps: AppConfig[] = []
  const seen = new Set<string>()

  data.forEach((item, index) => {
    const where = `App #${index + 1}`
    if (!isRecord(item)) {
      errors.push(`${where}: must be an object.`)
      return
    }
    const name = typeof item.id === 'string' ? `${where} ("${item.id}")` : where
    const before = errors.length

    for (const key of Object.keys(item)) {
      if (!KNOWN_KEYS.has(key)) errors.push(`${name}: unknown key "${key}".`)
    }

    const { id, label, entry, apiBase } = item
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      errors.push(`${name}: "id" must be a non-empty string of lowercase letters, digits and hyphens.`)
    } else if ((RESERVED_IDS as readonly string[]).includes(id)) {
      errors.push(`${name}: "id" must not be one of the reserved ids ${RESERVED_IDS.join(', ')}.`)
    } else if (seen.has(id)) {
      errors.push(`${name}: duplicate "id".`)
    } else {
      seen.add(id)
    }

    if (!isNonEmptyString(label)) errors.push(`${name}: "label" must be a non-empty string.`)

    if (!isNonEmptyString(entry) || !isAbsoluteUrlOrPath(entry)) {
      errors.push(`${name}: "entry" must be an absolute path (e.g. "/apps/${ID_PATTERN.test(String(id)) ? id : '<id>'}/embed.js") or an http(s) URL.`)
    }

    if (!isNonEmptyString(apiBase) || !isAbsoluteUrlOrPath(apiBase)) {
      errors.push(`${name}: "apiBase" must be an absolute path (e.g. "/api/<id>") or an http(s) URL.`)
    }

    let roles: string[] = []
    if (item.roles !== undefined) {
      if (!Array.isArray(item.roles) || !item.roles.every(isNonEmptyString)) {
        errors.push(`${name}: "roles" must be an array of non-empty strings.`)
      } else {
        roles = item.roles
      }
    }

    if (errors.length === before) {
      apps.push({
        id: id as string,
        label: (label as string).trim(),
        entry: entry as string,
        apiBase: (apiBase as string).replace(/\/+$/, ''),
        roles,
      })
    }
  })

  return errors.length > 0 ? { ok: false, errors } : { ok: true, apps }
}
