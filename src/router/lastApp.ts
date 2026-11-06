/** Remembers the last used app in localStorage (which may be unavailable, e.g. in private mode). */
const KEY = 'ediarum-platform:last-app'

export function getLastAppId(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLastAppId(id: string): void {
  try {
    window.localStorage.setItem(KEY, id)
  } catch {
    // Not persisted; the default target falls back to the first app.
  }
}
