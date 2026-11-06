/**
 * Validation of the `?next=` parameter of the login page, which must never become an open
 * redirect. Only router-internal paths (relative to the router base) are accepted.
 */

/**
 * Returns `next` if it is a safe router-internal path that `isKnownRoute` accepts, else null.
 *
 * Rejected: non-strings, anything not starting with exactly one '/', '//…', anything containing
 * '://' or a backslash (browsers treat '\' like '/'), control characters, and the same checks on
 * the percent-decoded form.
 */
export function validateNext(next: unknown, isKnownRoute: (path: string) => boolean): string | null {
  if (typeof next !== 'string' || next === '') return null
  let decoded: string
  try {
    decoded = decodeURIComponent(next)
  } catch {
    return null
  }
  for (const candidate of [next, decoded]) {
    if (!candidate.startsWith('/') || candidate.startsWith('//')) return null
    if (candidate.includes('://') || candidate.includes('\\')) return null
    if (/[\u0000-\u001f\u007f]/.test(candidate)) return null
  }
  return isKnownRoute(next) ? next : null
}
