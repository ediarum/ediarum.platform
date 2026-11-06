import type { InjectionKey } from 'vue'
import { validateApps, type AppConfig } from './validateApps'

/** The validated app list, provided by main.ts to all components. */
export const APPS: InjectionKey<readonly AppConfig[]> = Symbol('ep-apps')

/** Raised when `apps.json` cannot be loaded or is invalid; `details` are shown on the error page. */
export class ConfigError extends Error {
  constructor(public readonly details: string[]) {
    super(details.join('\n'))
    this.name = 'ConfigError'
  }
}

/** Where the platform reads its runtime app list from, e.g. `/config/apps.json`. */
export const APPS_CONFIG_URL = `${import.meta.env.BASE_URL}config/apps.json`

export async function loadApps(url: string = APPS_CONFIG_URL, fetchFn: typeof fetch = fetch): Promise<AppConfig[]> {
  let response: Response
  try {
    response = await fetchFn(url, { cache: 'no-cache', credentials: 'same-origin' })
  } catch (error) {
    throw new ConfigError([`${url} could not be fetched: ${String(error)}`])
  }
  if (!response.ok) {
    throw new ConfigError([`${url} could not be loaded (HTTP ${response.status}).`])
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new ConfigError([`${url} is not valid JSON.`])
  }

  const result = validateApps(data)
  if (!result.ok) throw new ConfigError(result.errors)
  return result.apps
}
