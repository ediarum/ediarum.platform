# Integrating an app into ediarum.platform

This guide is for teams that want their app (frontend and backend) to run inside
ediarum.platform, next to ediarum.webdav, ediarum.zotero and the others. It lists every
requirement, explains why it exists, and shows how existing apps met it.

After integration:

- the app's frontend is an ES module that the **platform** loads at runtime and mounts at
  `https://platform.ediarum.org/<id>/…`; the app's own header shows the platform's app menu and
  user menu;
- the app's backend answers under `https://platform.ediarum.org/api/<id>/…` and asks the
  **auth provider** who sent each request;
- the app has **no login, users or sessions of its own**. The platform provides login, logout,
  the profile page, the app menu and the user menu; users are managed in the auth provider (today
  ediarum.webdav).

The app relies on two contracts, and nothing else:

| Contract | Defines | Where |
|---|---|---|
| Mount contract | how the platform loads, mounts and unmounts the frontend | [`src/contract.ts`](../src/contract.ts) |
| Auth contract | how the backend finds out who the user is | [auth-contract.md](auth-contract.md) |

Reference implementations:

- [`dev/mock-app/`](../dev/mock-app/) in this repository: a minimal app (Vue, plain CSS).
- **ediarum.zotero**: a real app with Vue 3, Vuetify and a FastAPI backend. Its
  `frontend/src/embed.ts`, `frontend/src/vuetify.js`, `frontend/vite.config.js`,
  `frontend/src/services/api.js` and `app/core/auth.py` are referred to below.

---

## Contents

1. [Requirements at a glance](#1-requirements-at-a-glance)
2. [How the platform hosts an app](#2-how-the-platform-hosts-an-app)
3. [Frontend](#3-frontend)
4. [Backend](#4-backend)
5. [Deployment](#5-deployment)
6. [Local development](#6-local-development)
7. [Testing and checklist](#7-testing-and-checklist)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Requirements at a glance

**Frontend**

| # | Requirement | Section |
|---|---|---|
| F1 | An ES module exports `contractVersion` and a synchronous `mount(el, ctx)` that returns an unmount function | [3.2](#32-the-entry-module-srcembedts) |
| F2 | Everything is created per mount; unmount removes everything (app, router listener, global listeners, timers, requests in flight, DOM outside the app) | [3.2](#32-the-entry-module-srcembedts) |
| F3 | No login, logout, profile, user management, own user menu or auth guard | [3.3](#33-remove-login-and-user-management) |
| F4 | Router uses `createWebHistory(ctx.routerBase)`; no hash routing, no `window.location` writes for internal navigation | [3.4](#34-routing) |
| F5 | All API requests go to `ctx.apiBase`, same-origin, with `X-XSRF-TOKEN` on writes | [3.5](#35-api-requests) |
| F6 | 401 → `ctx.onUnauthorized()` once, then stop; 419 → refresh the CSRF cookie and retry once | [3.5](#35-api-requests) |
| F7 | No CSS reaches the platform, and the platform's CSS doesn't break the app: everything scoped to the app's root element, including the UI library's reset, theme and overlays | [3.6](#36-isolation-css-ui-libraries-global-state) |
| F8 | No module-level state, unprefixed storage keys or permanent `document.title` changes | [3.6](#36-isolation-css-ui-libraries-global-state) |
| F9 | The root fills `el` (`height: 100%`) and scrolls itself; no `100vh`, no fixed or sticky elements positioned against the viewport | [3.7](#37-layout) |
| F10 | Build: `base: '/apps/<id>/'`, entry `src/embed.ts`, output `embed.js` + `assets/`, exports preserved, CSS injected by JS | [3.8](#38-build) |
| F11 | Served as plain files: `embed.js` `no-cache`, `assets/*` immutable, no SPA fallback, query strings ignored | [3.9](#39-serving-the-bundle) |
| F12 | The app's header shows `<ediarum-home>` at the far left and `<ediarum-user-menu>` at the far right, on every screen | [3.10](#310-header-and-platform-controls) |

**Backend**

| # | Requirement | Section |
|---|---|---|
| B1 | No users, passwords, sessions, login endpoints or own cookies | [4.1](#41-what-to-remove) |
| B2 | Every non-public request is checked with the auth provider's `verify` (`AUTH_VERIFY_URL`), answers mapped exactly as in the auth contract | [4.2](#42-checking-requests-with-verify) |
| B3 | Public endpoints (for clients without a browser session) are explicit and read-only | [4.3](#43-public-endpoints) |
| B4 | Roles and project access are checked in the backend (403): project data only for members of the project or admins; the `roles` in `apps.json` only hide the app in the menu | [4.4](#44-roles-projects-and-per-user-data) |
| B5 | Errors are JSON; 401 never redirects; no stack traces in responses | [4.5](#45-errors) |
| B6 | Paths are relative to the backend's root (the proxy strips `/api/<id>`); no absolute URLs built from assumptions about the host | [4.6](#46-paths-and-urls) |

**Deployment**

| # | Requirement | Section |
|---|---|---|
| D1 | Frontend and backend reachable from the platform's reverse proxy; `verify` reachable from the backend | [5](#5-deployment) |
| D2 | Containers start ready to serve (e.g. database migrations run at startup) | [5](#5-deployment) |
| D3 | An entry in `apps.json` | [5](#5-deployment) |

---

## 2. How the platform hosts an app

### URLs

Everything is on one host, `platform.ediarum.org`. That is a requirement, not a convenience:
the session cookie belongs to that host, so the browser only sends it to services under it.

| URL | Served by |
|---|---|
| `/<id>/…` | the platform (`index.html`); your router renders the part after `/<id>` |
| `/apps/<id>/embed.js`, `/apps/<id>/assets/…` | your frontend container |
| `/api/<id>/…` | your backend (the proxy strips `/api/<id>`) |
| `/api/auth/…` | the auth provider |
| `/config/apps.json`, `/assets/…`, `/login`, `/profile` | the platform |

`<id>` is lowercase `[a-z0-9-]+` and must not be `login`, `profile`, `api`, `apps`, `config` or
`assets`. If the reverse proxy sends some path below `/<id>/` elsewhere (ediarum.webdav's WebDAV
endpoint at `/webdav/connection/…`), your app must not use routes under that path.

### URL examples

The examples use ediarum.zotero (id `zotero`, a library page at `/library/:slug`) and
ediarum.webdav. "Received as" is the path the service sees after the reverse proxy.

**1. A user opens a page of the app**

| Step | Browser requests | Answered by | Received as |
|---|---|---|---|
| Page | `https://platform.ediarum.org/zotero/library/bbaw-edition?collection=X7K2` | platform | `/zotero/library/bbaw-edition?collection=X7K2` → `index.html` |
| Platform code and app list | `/assets/index-Bk3f.js`, `/config/apps.json` | platform | unchanged |
| Session check | `/api/auth/me` | auth provider | `/webdav/api/auth/me` (webdav's Laravel lives under `/webdav`) |
| App bundle | `/apps/zotero/embed.js` | zotero frontend | `/embed.js` |
| Lazy chunks, fonts | `/apps/zotero/assets/LibraryView-9c1e.js`, `/apps/zotero/assets/materialdesignicons-webfont-a1b2.woff2` | zotero frontend | `/assets/LibraryView-9c1e.js`, … |

The platform then calls `mount(el, ctx)` with `ctx.routerBase = '/zotero/'` and
`ctx.apiBase = '/api/zotero'`. The app's router, created with `createWebHistory('/zotero/')`,
sees the path `/library/bbaw-edition?collection=X7K2`; the app never sees the `/zotero` prefix.

**2. The app calls its backend**

| The app calls | Browser requests | Zotero backend receives |
|---|---|---|
| `api.get('/libraries')` | `GET /api/zotero/libraries` | `GET /libraries` |
| `api.get('/library/bbaw-edition')` | `GET /api/zotero/library/bbaw-edition` | `GET /library/bbaw-edition` |
| `api.post('/library/bbaw-edition/sync')` | `POST /api/zotero/library/bbaw-edition/sync` (with `Cookie`, `X-XSRF-TOKEN`) | `POST /library/bbaw-edition/sync` |

For each protected request, the backend then asks the auth provider, server to server:

| Backend requests | Auth provider receives | Answer |
|---|---|---|
| `GET http://webdav/webdav/api/auth/verify` with the browser's `Cookie`, `X-Original-Method: POST`, `X-XSRF-TOKEN` | `/webdav/api/auth/verify` | `204` + `X-User: ada@example.org`, `X-User-Roles: `, `X-User-Projects: schleiermacher` |

**3. Navigation inside the app**

| User action | URL afterwards | What happens |
|---|---|---|
| Clicks a link to another library | `/zotero/library/other-edition` | the app's router handles it; no reload, no remount, no request for `embed.js` |
| Clicks "Zotero" in the platform menu | `/zotero` | the app's router follows to `/`; no remount |
| Clicks "WebDAV" in the platform menu | `/webdav` | zotero is unmounted, webdav's `embed.js` loaded and mounted |
| Presses back | `/zotero/library/other-edition` | webdav unmounted, zotero mounted again (`embed.js` is already loaded) |

**4. Login and logout**

| Situation | URL | Notes |
|---|---|---|
| Logged out, opens a deep link | `/zotero/library/bbaw-edition` → `/login?next=/zotero/library/bbaw-edition` | after login, back to the deep link |
| Session ends while the app is open (an API call gets 401) | `/login?next=/zotero/library/bbaw-edition` | the app called `ctx.onUnauthorized()` |
| Login form | `GET /api/auth/csrf-cookie`, `POST /api/auth/login` | answered by the auth provider |
| Opens the root | `/` → `/zotero` | the platform picks the default target: the last used app, else the first one the user may open, else `/profile` |
| Unknown path | `/foo` | the platform's "not found" page |

**5. Clients without a browser session**

| Client | URL | Notes |
|---|---|---|
| Oxygen framework reading citations | `https://platform.ediarum.org/api/zotero/library/bbaw-edition/items?format=xml` | public endpoint; backend receives `/library/bbaw-edition/items?format=xml` and doesn't call `verify` |
| The same client on a protected endpoint | `https://platform.ediarum.org/api/zotero/libraries` | `401`: there is no cookie |
| Oxygen as WebDAV client | `https://platform.ediarum.org/webdav/connection/my-edition/data/letter-001.xml` | ediarum.webdav, HTTP Basic auth; unrelated to the platform although it starts with `/webdav/` |

**6. ediarum.webdav as an app**

webdav is an app like any other (id `webdav`), and also the auth provider, so it appears in
three places:

| Browser URL | Answered by | Received as |
|---|---|---|
| `/webdav/projects/12` | platform | `index.html`; webdav's router sees `/projects/12` |
| `/apps/webdav/embed.js` | webdav (static files) | `/webdav/apps/webdav/embed.js` |
| `/api/webdav/projects/12` | webdav | `/webdav/api/webdav/projects/12` |
| `/api/auth/verify` | webdav | `/webdav/api/auth/verify` |
| `/webdav/connection/my-edition/` | webdav (WebDAV protocol) | `/webdav/connection/my-edition/` |

**7. The same URLs during local development** (platform dev server, see [6](#6-local-development))

| Browser requests | Answered by | Received as |
|---|---|---|
| `http://localhost:5173/zotero/library/bbaw-edition` | platform dev server | `index.html` |
| `http://localhost:5173/api/auth/verify` | mock auth provider in the dev server | — |
| `http://localhost:5173/apps/zotero/embed.js` | build directory: `dist/embed.js`; dev server form: `http://localhost:5174/apps/zotero/src/embed.ts` | — |
| `http://localhost:5173/api/zotero/libraries` | your backend | `http://localhost:8004/libraries` |

### `apps.json`

The platform reads its list of apps at runtime from `/config/apps.json`:

```json
{ "id": "zotero", "label": "Zotero", "entry": "/apps/zotero/embed.js", "apiBase": "/api/zotero", "roles": [] }
```

| Field | Meaning |
|---|---|
| `id` | URL segment, see above |
| `label` | Menu text |
| `entry` | URL of your ES module |
| `apiBase` | Passed to your app as `ctx.apiBase` |
| `roles` | If non-empty, only users with at least one of these roles see and can open the app |

### Lifecycle

1. When the user opens `/<id>/…`, the platform loads `entry` with a native `import()`. If that
   fails, it shows "currently unavailable" with a retry button; a retry appends
   `?platform-retry=<n>` to the URL, because browsers may cache failed module fetches.
2. It checks that the module exports `contractVersion` equal to the platform's
   `CONTRACT_VERSION` and a `mount` function. Otherwise it shows an error.
3. It calls `mount(el, ctx)` with an empty element that fills the content area (below the
   platform's top bar, which is hidden while the app shows the platform controls, see 3.10)
   (`height: 100%`), and keeps the returned function.
4. Navigation inside the app does **not** remount it: your router handles it. The platform router
   and yours share `window.history`; the platform makes sure back/forward work across both.
5. When the user switches to another app, logs out, logs in as someone else, or the session ends
   (401), the platform calls the unmount function and removes `el`. The same module may be mounted
   again later, without being reloaded.

---

## 3. Frontend

The examples use Vue 3 and vue-router, which all current apps use. The requirements themselves
don't depend on the framework: any code that can render into an element and clean up after itself
works.

### 3.1 The contract file

Copy [`src/contract.ts`](../src/contract.ts) verbatim into your app as `src/platform/contract.ts`. It
has no imports. Add a comment at the top with the platform commit it was taken from, so drift
between apps is easy to spot. Vite compiles `.ts` imports in a JavaScript project without extra
setup.

```ts
export const CONTRACT_VERSION = 1

export interface MountContext {
  routerBase: string          // e.g. '/zotero/'; use with createWebHistory()
  apiBase: string             // e.g. '/api/zotero'; prefix for all API requests
  user: { name: string; roles: string[] }
  onUnauthorized: () => void  // call on a 401 from your backend
}

export type Mount = (el: HTMLElement, ctx: MountContext) => () => void
```

### 3.2 The entry module `src/embed.ts`

`src/embed.ts` replaces `index.html` and `src/main.ts`; the app no longer needs them.

Keep the real app in modules that don't know how they are mounted (a `routes` array, a context
object), so `embed.ts` stays a thin wrapper:

```ts
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { CONTRACT_VERSION, type Mount } from './platform/contract'
import App from './App.vue'
import { routes } from './routes'
import { createAppContext, APP_CONTEXT } from './context'

export { CONTRACT_VERSION as contractVersion }

export const mount: Mount = (el, ctx) => {
  // One root element for the app and everything it renders outside its component tree
  const root = document.createElement('div')
  root.className = 'myapp-root'
  const appEl = document.createElement('div')
  const overlays = document.createElement('div')   // target for dialogs, menus, tooltips
  root.append(appEl, overlays)
  el.append(root)

  const context = createAppContext(ctx)              // API client, shared state: per mount
  const router = createRouter({ history: createWebHistory(ctx.routerBase), routes })
  const app = createApp(App)
  app.provide(APP_CONTEXT, context)
  app.use(router)
  app.mount(appEl)

  return () => {
    context.dispose()                    // abort requests in flight, stop polling
    app.unmount()
    router.options.history.destroy()     // removes the router's popstate listener
    root.remove()
  }
}
```

Rules:

- **Synchronous.** `mount` returns the unmount function immediately. Load data inside the app as
  usual.
- **Everything per mount.** App, router, stores (Pinia), UI library instance, API client and any
  shared `ref`s are created inside `mount`. The module stays loaded between mounts, so
  module-level state (a `const user = ref(null)` at the top of a composable) leaks from one
  user's session into the next. Move such state into a per-mount context (`provide`/`inject`).
- **Unmount undoes everything.** After the unmount function returns, nothing of the app may run or
  remain: no listeners on `window`/`document`, no timers, no WebSockets or `EventSource`s, no
  pending requests that update state later, no DOM outside `el`, no injected `<style>` that isn't
  shared by all mounts. Afterwards the app must not touch `window.history`.
- **Cancel requests on unmount.** Long-running work (batch loading, sync loops, polling) must end
  when the app is unmounted. An `AbortController` per mount, passed as `signal` to every request,
  does this in one place (ediarum.zotero: `createApi` in `services/api.js`, `dispose` in
  `context.js`).

### 3.3 Remove login and user management

Delete from the frontend:

- login and logout UI, "forgot password", set-password and invite pages
- user menu, profile and password pages, user management (lists, invites, resets)
- the user menu, logout button and any link back to a portal or app list (the platform controls
  in your header replace them, see 3.10)
- router guards that redirect to a login page, and "who am I" calls before rendering

The platform mounts the app only for logged-in users who have one of the app's `roles`. `ctx.user`
is the user at mount time; if the user changes, the app is remounted.

### 3.4 Routing

- Create the router with `createWebHistory(ctx.routerBase)`. All links then resolve to
  `/<id>/…`. The app's own routes stay as they were (`/`, `/library/:slug`, …).
- Never use hash routing, and never write `window.location` for internal navigation.
- Deep links and reloads work automatically: the platform serves `index.html` for every `/<id>/…`
  URL and passes the rest of the path to your router.

### 3.5 API requests

- Prefix every request with `ctx.apiBase`; never hard-code a host or read it from an env
  variable. Requests are same-origin, so the session cookie is sent automatically (fetch's default
  `credentials: 'same-origin'`; axios needs no setting).
- **Writes** (anything but GET/HEAD/OPTIONS) send the value of the `XSRF-TOKEN` cookie as the
  `X-XSRF-TOKEN` header. axios does this automatically for same-origin requests; with fetch, read
  the cookie yourself (example below).
- **401**: call `ctx.onUnauthorized()` **once** and stop. The platform unmounts the app, shows its
  login page, and returns the user to the same URL afterwards. Don't show your own error or login
  UI. Several requests may fail with 401 at the same time; guard the call with a flag.
- **419** (CSRF token missing or expired): fetch a fresh cookie with `GET /api/auth/csrf-cookie`,
  then retry the request once. If it fails again, treat it as an error.
- **503** from your backend means the auth provider was unreachable; show it as a normal error.

A complete fetch-based client:

```ts
// src/api.ts
import type { MountContext } from './platform/contract'

const CSRF_COOKIE_URL = '/api/auth/csrf-cookie'
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

function xsrfToken(): string | null {
  const match = /(?:^|;\s*)XSRF-TOKEN=([^;]*)/.exec(document.cookie)
  return match ? decodeURIComponent(match[1]!) : null
}

export function createApi(ctx: MountContext) {
  const controller = new AbortController()
  let unauthorized = false

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const token = xsrfToken()
    if (!SAFE.has(method) && token) headers['X-XSRF-TOKEN'] = token
    return fetch(`${ctx.apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response = await send(method, path, body)
    if (response.status === 419) {
      await fetch(CSRF_COOKIE_URL, { signal: controller.signal })
      response = await send(method, path, body)
    }
    if (response.status === 401) {
      if (!unauthorized) {
        unauthorized = true
        ctx.onUnauthorized()
      }
      throw new Error('Unauthorized')
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
    dispose: () => controller.abort(),
  }
}
```

For axios, the same logic as an interceptor is in ediarum.zotero's `services/api.js`.

**Links for external clients.** If the app shows URLs that other programs use (e.g. a public
endpoint for an Oxygen framework), build them as `` `${window.location.origin}${ctx.apiBase}/…` ``,
never from a configured host name.

### 3.6 Isolation: CSS, UI libraries, global state

The app shares the page, `window` and the CSS cascade with the platform and, over time, with other
apps. Isolation goes both ways: your CSS must not change the platform, and the platform's CSS must not
change your app.

**Your own CSS**

- No rules for `html`, `body`, `:root`, `#app`, `*` or bare elements (`button`, `a`, `h1`) that
  aren't scoped to your root element. No global resets.
- Use `<style scoped>` or classes with an app prefix (`.zotero-…`). Prefix custom properties
  (`--zotero-…`); the platform's are `--ep-…`.

**UI libraries (Vuetify, PrimeVue, Bootstrap, …)** usually come with a global reset, theme
variables on `:root`, and overlays that are teleported to `<body>`. All three must be confined to
your root element:

1. **Scope all CSS at build time.** A PostCSS step prefixes every rule of the bundle with your
   root class. `html`, `body` and `:root` rules become rules for the root element itself; rules
   that describe the document (`html.dark`) are dropped; keyframes are left alone.

   ```js
   // vite.config.js
   const ROOT = '.myapp-root'

   function splitSelectors(list) {           // split at top-level commas only
     const parts = []; let depth = 0; let start = 0
     for (let i = 0; i < list.length; i++) {
       const ch = list[i]
       if (ch === '(' || ch === '[') depth++
       else if (ch === ')' || ch === ']') depth--
       else if (ch === ',' && depth === 0) { parts.push(list.slice(start, i)); start = i + 1 }
     }
     parts.push(list.slice(start))
     return parts.map((s) => s.trim()).filter(Boolean)
   }

   function scopeSelector(selector) {
     if (selector.startsWith(ROOT)) return selector
     const root = /^(html|body|:root)(?![\w-])/.exec(selector)
     if (root) {
       const rest = selector.slice(root[0].length)
       if (rest === '') return ROOT
       return /^\s/.test(rest) ? ROOT + rest : null   // `html .x` → inside; `html.x` → drop
     }
     return `${ROOT} ${selector}`
   }

   function scopeToRoot() {
     return {
       postcssPlugin: 'scope-to-root',
       Rule(rule) {
         if (rule.__scoped) return
         rule.__scoped = true
         for (let p = rule.parent; p; p = p.parent) {
           if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return
         }
         const selectors = splitSelectors(rule.selector).map(scopeSelector).filter(Boolean)
         if (selectors.length) rule.selector = [...new Set(selectors)].join(',\n')
         else rule.remove()
       },
     }
   }
   scopeToRoot.postcss = true

   export default defineConfig({
     css: { postcss: { plugins: [scopeToRoot()] } },
     // …
   })
   ```

   `@font-face` rules stay global, which is harmless; icon fonts (e.g. `@mdi/font`) keep working.

2. **Theme variables** must apply to your root, not `:root`, and be removed on unmount. Vuetify:
   `theme: { scope: '.myapp-root', stylesheetId: 'myapp-vuetify-theme' }`, and remove the element
   with that id in the unmount function.

3. **Overlays** (dialogs, menus, tooltips, snackbars, select lists) must render inside your root,
   or the scoped CSS doesn't reach them. Create an overlay container inside the root (see
   [3.2](#32-the-entry-module-srcembedts)) and point the library at it. Vuetify, per mount:

   ```js
   const overlay = { attach: overlayTarget }
   createVuetify({
     defaults: {
       VOverlay: overlay, VMenu: overlay, VTooltip: overlay, VSnackbar: overlay,
       // 'block' would add classes and styles to the platform's <html> and scroll containers
       VDialog: { ...overlay, scrollStrategy: 'none' },
     },
     // …
   })
   ```

   Call `vuetify.unmount()` in the unmount function. The complete setup is ediarum.zotero's
   `frontend/src/vuetify.js`.

4. **Layout components** that position themselves against the viewport (`v-app-bar`,
   `v-navigation-drawer`, `v-main` with app-bar offsets, `position: fixed` headers) don't belong
   inside `mount`; see [3.7](#37-layout).

**Global state**

- Pinia store ids, `localStorage`/`sessionStorage` keys and custom events are prefixed with the
  app id (`defineStore('zotero-library', …)`, `zotero-lastLibrary`).
- Don't set `document.title` permanently; if you set it, restore it on unmount.
- Don't register global error handlers (`window.onerror`, `unhandledrejection`) without removing
  them on unmount.

### 3.7 Layout

- `el` has `height: 100%`. Give your root element `height: 100%` and `overflow-y: auto`, so the
  app scrolls inside its area. Use `100%`, not `100vh`: the platform's top bar may take part of
  the viewport (3.10).
- Your header is part of your layout: keep it at the top of your root, outside the scrolling
  content, not fixed to the viewport.
- No `position: fixed` or `position: sticky` relative to the viewport for app chrome. Sticky
  elements inside your own scroll container are fine.
- The app keeps its own sub-navigation (tabs, side bar, breadcrumbs) inside its area.

### 3.8 Build

```js
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'

export default defineConfig({
  base: '/apps/zotero/',
  plugins: [vue(), cssInjectedByJs()],
  css: { postcss: { plugins: [/* scopeToRoot(), see 3.6 */] } },
  build: {
    // Vite ≤ 7: rollupOptions. Vite 8: rolldownOptions (rollupOptions still works, deprecated).
    rollupOptions: {
      input: 'src/embed.ts',
      // Without this, the bundler may drop the `mount` / `contractVersion` exports of the entry
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: 'embed.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
```

- `base` must be `/apps/<id>/`, in production and in dev, so lazy-loaded chunks and assets load
  from your container.
- `vite-plugin-css-injected-by-js` is needed because a JS entry doesn't load its extracted CSS
  file; the plugin injects the CSS when `embed.js` runs. The injected `<style>` tags stay after
  unmount, which is fine because they are scoped and the same module is reused on the next mount.
- The app keeps its own copy of Vue and its libraries. That's intended: apps are independent of
  the platform's versions.
- Check the result: `dist/embed.js` must end with `export { … as contractVersion, … as mount }`.

### 3.9 Serving the bundle

The frontend container serves `dist/` as plain files. The reverse proxy maps `/apps/<id>/` to its
root.

| File | `Cache-Control` |
|---|---|
| `embed.js` | `no-cache` (the platform must always get the current version) |
| `assets/*` | `public, max-age=31536000, immutable` (hashed file names) |
| anything else | 404 (no `index.html`, no SPA fallback: the platform serves the pages) |

Query strings (`?platform-retry=1`) must be ignored, which nginx does by default:

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;

    location = /embed.js { add_header Cache-Control "no-cache"; }
    location /assets/    { add_header Cache-Control "public, max-age=31536000, immutable"; }
    location /           { return 404; }
}
```

If the proxy does not strip the prefix, serve `dist/` under `/apps/<id>/` instead.

### 3.10 Header and platform controls

There is one header on the screen, and it is yours. The platform provides two controls for it as
custom elements:

| Element | Shows | Place |
|---|---|---|
| `<ediarum-home>` | the ediarum wordmark; opens the list of apps the user may use | far left |
| `<ediarum-user-menu>` | the user's name; opens Profile and Log out | far right |

The platform defines them before it mounts any app. You only write the tags; there is nothing to
import, configure or clean up:

```vue
<v-app-bar>
  <ediarum-home></ediarum-home>
  <v-app-bar-title>Zotero</v-app-bar-title>
  <v-spacer></v-spacer>
  <!-- your own buttons -->
  <ediarum-user-menu></ediarum-user-menu>
</v-app-bar>
```

Tell Vue's compiler that these are custom elements, not components:

```js
// vite.config.js
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('ediarum-') } } })
```

- **One header.** While `<ediarum-user-menu>` is inside your element, the platform hides its own
  top bar. If it is missing (an app that has not adopted this yet, or a screen without your
  header), the platform shows its top bar above your app, so the user can always switch apps and
  log out.
- **Every screen.** Render the header on every screen, including loading, error and empty states.
  At narrow widths keep both controls visible: don't move them into a drawer or hamburger menu, and
  don't put them inside another link or button.
- **Isolated.** Each control renders in its own shadow root: your CSS (including the scoped UI
  library reset) does not reach inside, and the platform's CSS does not leak out. The menus open in
  the browser's top layer, so `overflow: hidden` or a z-index on your header doesn't clip them.
- **Theming.** The controls inherit `font` and `color` from your header. For a dark header, set
  these custom properties on it:

  | Property | Default | Used for |
  |---|---|---|
  | `--ep-controls-color` | inherited `color` | text of both buttons |
  | `--ep-controls-brand` | ediarum red | the wordmark |
  | `--ep-controls-hover` | translucent grey | button background on hover and while open |

  The open menus use the platform's own colors.
- **Outside the platform** (your own dev server, tests), the tags are unknown elements and render
  as nothing.

The mock app (`dev/mock-app/src/MockApp.vue`) is a working example.

---

## 4. Backend

The backend can be written in any language. The exact rules are in the
[auth contract](auth-contract.md#using-the-contract-in-an-app-backend); this section explains
them and shows a working implementation.

### 4.1 What to remove

- user and session tables, password hashing, login/logout/me/register endpoints
- invite and password reset flows, and the mail setup that only they used
- session cookies and any other cookies (the platform host's cookie names belong to the auth
  provider)
- seed scripts for users

### 4.2 Checking requests with `verify`

One setting: `AUTH_VERIFY_URL`, the URL of the provider's `verify` endpoint as reachable from the
backend (e.g. `http://webdav/webdav/api/auth/verify` on an internal network).

For every request to a protected endpoint:

1. Call `GET AUTH_VERIFY_URL` with these headers from the incoming request:

   | Header sent to `verify` | Value |
   |---|---|
   | `Cookie` | the incoming `Cookie` header, unchanged |
   | `X-Original-Method` | the incoming method (`GET`, `POST`, …) |
   | `X-XSRF-TOKEN` | the incoming `X-XSRF-TOKEN` header, if present |

   Use one shared HTTP client with keep-alive and a short timeout (a few seconds).

2. Map the answer:

   | `verify` answers | Your backend |
   |---|---|
   | 204 with `X-User` | proceeds; user = `X-User` (email), roles = `X-User-Roles`, projects = `X-User-Projects`, each split by `,` (empty → none) |
   | 204 without `X-User` | 503, logged |
   | 401 | 401 |
   | 419 | 419 |
   | anything else, timeout, connection error | 503, logged |

   Never treat a failed `verify` as logged in.

FastAPI (from ediarum.zotero's `app/core/auth.py`, shortened):

```python
@dataclass(frozen=True)
class CurrentUser:
    email: str
    roles: list[str]
    projects: list[str]

    def can_access(self, project: str) -> bool:
        # The contract's access rule: members of the project, and admins for every project
        return "admin" in self.roles or project in self.projects

def split(value: str) -> list[str]:
    return [v for v in value.split(",") if v]

async def current_user(request: Request) -> CurrentUser:
    client: httpx.AsyncClient = request.app.state.verify_client   # created in the lifespan
    headers = {"X-Original-Method": request.method}
    for name in ("cookie", "x-xsrf-token"):
        if (value := request.headers.get(name)) is not None:
            headers[name] = value
    try:
        res = await client.get(settings.auth_verify_url, headers=headers)
    except httpx.HTTPError as exc:
        logger.error("Auth verify request failed: %r", exc)
        raise HTTPException(503, "Authentication service unavailable")
    if res.status_code == 204 and res.headers.get("x-user"):
        return CurrentUser(
            email=res.headers["x-user"],
            roles=split(res.headers.get("x-user-roles", "")),
            projects=split(res.headers.get("x-user-projects", "")),
        )
    if res.status_code in (401, 419):
        raise HTTPException(res.status_code)
    logger.error("Auth verify answered %s", res.status_code)
    raise HTTPException(503, "Authentication service unavailable")

public = APIRouter()                                             # see 4.3
protected = APIRouter(dependencies=[Depends(current_user)])     # everything else
```

The same in other stacks: a middleware (Express, Laravel, Django) or filter (Spring) in front of
all protected routes. Putting the check on the router, not on each endpoint, means a new endpoint
can't be forgotten.

**Optional caching.** A result may be cached for a few seconds for GET requests, keyed by the full
`Cookie` header. Logout then takes that long to reach the app. Never cache for writes: the CSRF
check must run on every one.

**Development user.** A setting that makes every request come from a fixed user, without calling
`verify`, is useful for working on the backend alone (ediarum.zotero: `AUTH_DEV_USER`). If you add
one: make it mutually exclusive with `AUTH_VERIFY_URL`, refuse to start when both or neither are
set, and log a warning at startup. It must never be set in production.

### 4.3 Public endpoints

Endpoints for clients without a browser session (an Oxygen framework, a script, another server)
skip the check. Keep them explicit (a separate router) and read-only, and don't return secrets or
internal ids in them. Anything that changes data needs a user.

### 4.4 Roles, projects and per-user data

- `roles` in `apps.json` only hide the app from the menu; that check runs in the browser. If an
  endpoint needs a role, check `CurrentUser.roles` in the backend and answer 403.
- **Projects** are platform-wide (an edition such as "Schleiermacher in Berlin"); the auth
  provider keeps them and their members ([auth contract, "Projects"](auth-contract.md#projects)).
  Your app attaches its data to a project by storing the project's **slug** (e.g. a zotero
  library has a `project` column), never by copying the project list or the memberships.
- **Access rule:** a user may access a project's data if the slug is in `CurrentUser.projects`
  or the user has the role `admin` (admins may access every project). Check it in the backend on
  every request that touches project data: single items → 403 (or 404, to not reveal that the
  item exists); lists → only accessible items.

  ```python
  @protected.get("/library/{slug}")
  def get_library(slug: str, db: SessionDep, user: CurrentUser = Depends(current_user)):
      library = fetch_library(slug, db)
      if library is None or not user.can_access(library.project):
          raise HTTPException(404)
      return library

  @protected.get("/libraries")
  def get_libraries(db: SessionDep, user: CurrentUser = Depends(current_user)):
      return [lib for lib in fetch_libraries(db) if user.can_access(lib.project)]
  ```

- **Project names** (e.g. for a project selector when creating a library) come from
  `GET /api/auth/projects`: it returns the projects the user may access, all of them for admins.
  The frontend can call it directly (same origin); a backend that needs to validate a slug calls
  it with the user's forwarded `Cookie`.
- The frontend gets the user's project slugs as `ctx.user.projects`, e.g. to preselect a project.
  It's a convenience for the UI; the backend enforces access.
- Per-user data is keyed by the email (`X-User`), which is unique and stable. Don't store the
  display name as a key; it can change.

### 4.5 Errors

- Error responses are JSON (`{ "detail": "…" }` or `{ "message": "…" }`); the frontend shows the
  message.
- Unauthenticated requests get 401, never a redirect to a login page, regardless of the `Accept`
  header. `EventSource` can't send an `Accept` header, so don't rely on it.
- No stack traces or exception details in responses: log them, and answer with a generic message.

### 4.6 Paths and URLs

- The proxy strips `/api/<id>`: a request to `/api/zotero/libraries` arrives as `/libraries`.
  Keep the backend's routes relative to its root.
- If the backend must produce absolute URLs (links in responses, redirects), take the public host
  and scheme from the `Host` and `X-Forwarded-Proto` headers or from configuration, and add
  `/api/<id>` yourself.
- Long responses (Server-Sent Events, streamed progress) need proxy buffering off: send
  `X-Accel-Buffering: no` with the response.

---

## 5. Deployment

**Reverse proxy** (operated by the platform; for reference):

```nginx
location /api/zotero/   { proxy_pass http://<zotero-backend>/; }
location /apps/zotero/  { proxy_pass http://<zotero-frontend>/; }
```

The proxy does no auth checks; your backend does. Frontend and backend can run anywhere the proxy
can reach. The backend also has to reach `verify`.

**Containers**

- Frontend: build stage (`npm ci && npm run build`) and an nginx stage with the config from
  [3.9](#39-serving-the-bundle).
- Backend: environment variable `AUTH_VERIFY_URL` (plus the app's own settings). The container
  must be ready when it starts: run database migrations in the entrypoint before the server starts.
- No published ports are needed; only the reverse proxy is public.

**Registration:** add the app's entry to the platform's `public/config/apps.json` and deploy the
platform. Browsers pick up the change on the next page load.

**Running an app on its own.** There is no separate standalone build. To run an app outside the
shared deployment (for another project, or a demo), deploy on one host: the platform with an
`apps.json` that lists only this app, the app's containers, and an auth provider at `/api/auth/`
(ediarum.webdav, or anything implementing [the auth contract](auth-contract.md)).

---

## 6. Local development

The platform's dev server can host your real app on your machine, with the login mocked. You run
three processes; the browser only talks to the platform's dev server, which forwards to the other
two. Everything is reached through one host (`localhost:5173`), so the session cookie works
exactly as in production.

```
browser ──▶ localhost:5173  (platform dev server, ediarum.platform: npm run dev)
              ├─ /, /login, /<id>/…      platform
              ├─ /api/auth/…             mock auth provider (in memory)
              ├─ /apps/<id>/…  ─────────▶ your frontend: build directory, or Vite dev server :5174
              └─ /api/<id>/…   ─────────▶ your backend :8004 (prefix stripped)
                                            └─ verify ──▶ localhost:5173/api/auth/verify
```

### 6.1 Prerequisites

- Node 24 for the platform (`nvm use` in ediarum.platform reads `.nvmrc`). Older Node versions fail
  at `npm test` with `ERR_REQUIRE_ESM`.
- ediarum.platform checked out, with `npm ci` run once.
- Your app's repository. The examples assume both repositories side by side
  (`~/ediarum.platform`, `~/ediarum.zotero`); relative paths in `.env.local` are relative to
  ediarum.platform.
- Free ports: 5173 (platform), your backend's port (8004 below), and 5174 if you use your frontend's
  dev server. If 5173 is taken, Vite silently picks another port, and `AUTH_VERIFY_URL` then points
  at the wrong place: start the platform with `npm run dev -- --strictPort` to fail instead.

### 6.2 Configure the platform

Two things tell the platform about your app: an entry in the app list, and where your frontend and
backend run.

**App list.** `npm run dev` serves `dev/apps.json`, which already contains zotero, webdav and
index. For another app, either add an entry there or point the platform at your own file (keeps
`dev/apps.json` untouched):

```json
// ../myapp/dev/platform-apps.json
[
  { "id": "myapp", "label": "My App", "entry": "/apps/myapp/embed.js", "apiBase": "/api/myapp", "roles": [] }
]
```

**Overrides.** Create `.env.local` in ediarum.platform (ignored by git):

```sh
# Your app (paths relative to ediarum.platform)
EDIARUM_DEV_BACKENDS=myapp=http://localhost:8004
EDIARUM_DEV_BUNDLES=myapp=../myapp/frontend/dist
# Optional: your own app list instead of dev/apps.json
EDIARUM_APPS_JSON=../myapp/dev/platform-apps.json
```

| Variable | Value | Effect |
|---|---|---|
| `EDIARUM_DEV_BACKENDS` | `<id>=<URL>` | `/api/<id>/…` → `<URL>/…`, prefix stripped as in production |
| `EDIARUM_DEV_BUNDLES` | `<id>=<directory>` | `/apps/<id>/…` → files from a build (`vite build --watch`) |
| `EDIARUM_DEV_BUNDLES` | `<id>=<URL>` | `/apps/<id>/…` → your Vite dev server, with hot reload; `embed.js` is served from `src/embed.ts` |
| `EDIARUM_APPS_JSON` | file path | app list served at `/config/apps.json` (default: `dev/apps.json`) |

Several apps are separated by commas (`zotero=http://localhost:8004,myapp=http://localhost:8010`).
Apps that aren't overridden keep the mock behavior: their backend is the mock app backend, and
without a bundle they show "currently unavailable". `.env.local` is read at startup: restart
`npm run dev` after changing it. At startup, the dev server prints the active overrides
(`/apps/myapp/ → …`, `/api/myapp/ → …`); if those lines are missing, the variables weren't read.

### 6.3 Run your backend

Two ways to authenticate locally:

| | Setting | Use when |
|---|---|---|
| Mock provider | `AUTH_VERIFY_URL=http://localhost:5173/api/auth/verify` | testing the real flow: login, logout, 401, 419, roles |
| Development user | e.g. `AUTH_DEV_USER=dev@example.org` (if your backend has one, see [4.2](#42-checking-requests-with-verify)) | working on the backend or UI without caring about login |

With the mock provider, the platform must be running before your backend gets its first request.

Before the first start, create the database (e.g. `uv run alembic upgrade head`); local starts
don't run the container's entrypoint. Then start the backend on the port from
`EDIARUM_DEV_BACKENDS`, with auto-reload:

```sh
cd ~/ediarum.zotero && uv run fastapi dev app/core/main.py --port 8004
```

### 6.4 Run your frontend

| | Command | `EDIARUM_DEV_BUNDLES` value | After a change |
|---|---|---|---|
| **Build** (closest to production; use this to sign off) | `npx vite build --watch` | the `dist` directory | reload the page once the build has finished |
| **Dev server** (fastest) | `npx vite --port 5174 --strictPort` | `http://localhost:5174` | nothing: `.vue` changes apply in place; other changes reload the page |

The dev server form needs `base: '/apps/<id>/'` in dev mode too (not only for the build) and the
entry file `src/embed.ts`. It differs from production in how CSS is injected and in chunking, and
hot updates keep module state that a real remount would reset. Check the final result with the
build form.

### 6.5 Start the platform and log in

```sh
cd ~/ediarum.platform
nvm use
npm run dev
```

Open `http://localhost:5173/<id>/` and log in:

| Email | Password | Roles | Projects |
|---|---|---|---|
| `ada@example.org` | `password` | none | `schleiermacher` |
| `admin@example.org` | `password` | `admin` | none, but admins may access every project |

The mock knows two projects: `schleiermacher` ("Schleiermacher in Berlin") and `umfeldbriefe`
("Umfeldbriefe"). Use `ada` to check that an app with `roles: ["admin"]` is hidden, that
admin-only endpoints answer 403, and that data of `umfeldbriefe` is neither listed nor reachable;
use `admin` to check that everything is.

### 6.6 Check the setup

Each layer can be checked on its own with `curl`, which narrows down problems quickly:

```sh
# Frontend: must be JavaScript, not HTML
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' localhost:5173/apps/myapp/embed.js

# Backend through the platform, without a session: 401 (or your public endpoint's data)
curl -s -o /dev/null -w '%{http_code}\n' localhost:5173/api/myapp/<protected path>

# Log in with a cookie jar, then the same request: 200
curl -s -c jar -b jar localhost:5173/api/auth/csrf-cookie
XSRF=$(awk '$6=="XSRF-TOKEN"{print $7}' jar)
curl -s -c jar -b jar -H "X-XSRF-TOKEN: $XSRF" -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.org","password":"password"}' localhost:5173/api/auth/login
curl -s -b jar localhost:5173/api/myapp/<protected path>

# What verify says for this session: 204 with X-User / X-User-Roles
curl -s -D - -o /dev/null -b jar localhost:5173/api/auth/verify
```

### 6.7 Testing auth situations

| Situation | How to produce it locally | Expected |
|---|---|---|
| Session ended | Log out in another tab, then use the app | Next request → 401 → platform login page; afterwards back on the same URL |
| Server forgot all sessions | Restart `npm run dev` (the mock keeps everything in memory) | As above |
| Stale CSRF token | Restart `npm run dev`, log in again in another tab, then save something in the app | 419 → cookie refreshed → retry succeeds |
| Other user | Log out, log in as the other user | App remounted, no data of the previous user |
| Missing role | Log in as `ada` | Admin-only app hidden, admin-only endpoints 403 |
| Not a project member | Log in as `ada`, open data of `umfeldbriefe` (e.g. by URL) | Not listed; direct access 403 or 404 |
| Auth provider down | Stop the platform while the backend runs, call the backend directly (`curl localhost:8004/…`) | 503, logged; never 200 |
| Unmount cleanup | Start a long-running action, switch to another app | Requests stop (browser network tab), no console errors |

### 6.8 Against a real auth provider

To test with ediarum.webdav instead of the mock: run webdav, your app and the platform behind one
local reverse proxy (one host for all of them), and start the platform with `npm run dev:proxy`
pointed at that proxy (`EDIARUM_PROXY_TARGET`, in `.env.proxy.local`). `EDIARUM_DEV_BACKENDS` and
`EDIARUM_DEV_BUNDLES` work there too, to swap single apps of the stack for your local ones.
Your backend's `AUTH_VERIFY_URL` then points at webdav's `verify`.

### 6.9 Backend tests without the platform

Unit tests don't need a running provider. Replace the dependency that calls `verify`:

```python
# FastAPI: a logged-in user for most tests
app.dependency_overrides[current_user] = lambda: CurrentUser(email="ada@example.org", roles=[])
```

and test the `verify` client itself against a stubbed HTTP transport (e.g.
`httpx.MockTransport`), covering: 204 with headers, 204 without `X-User`, 401, 419, 500,
timeout. Also check that `Cookie`, `X-Original-Method` and `X-XSRF-TOKEN` are forwarded.

### 6.10 Local troubleshooting

| Symptom | Cause |
|---|---|
| "… is currently unavailable." and `embed.js` returns HTML | No bundle override for this app: `EDIARUM_DEV_BUNDLES` missing, misspelled id, or the platform wasn't restarted after editing `.env.local` |
| `embed.js` returns 404 with "No embed.js in …" | The build hasn't run yet, or the directory is wrong |
| Dev server form: chunks or `@vite/client` 404 | `base` isn't `/apps/<id>/` in dev mode |
| Every request 500 | Backend error, often the database (migrations not run): see the backend's log |
| Every request 503 | Backend can't reach `AUTH_VERIFY_URL` (platform not running, wrong port) |
| Every request 401 although logged in | Backend called directly (`localhost:8004`) instead of through `localhost:5173`, so no cookie; or `Cookie` not forwarded to `verify` |
| Backend ignores logout | It runs with a development user instead of `AUTH_VERIFY_URL` |
| Port 5174 already in use | Another dev server (often a leftover); stop it, or use another port in both places |

## 7. Testing and checklist

### Functional tests in the platform

- [ ] The app opens from the menu and from a deep link; reloading a deep link works.
- [ ] Back and forward work within the app and across apps.
- [ ] Switching to another app and back works repeatedly, without errors in the console and
      without duplicated listeners (e.g. a key handler that fires twice).
- [ ] Long-running work stops when switching away (no requests continue in the network tab).
- [ ] Dialogs, menus, tooltips and notifications appear inside the app area, styled correctly.
- [ ] The app's header shows the app menu and user menu on every screen, and the platform's top
      bar is not shown above it.
- [ ] The platform's top bar (e.g. on the profile page), its menus, login and profile pages look
      exactly as without the app (no changed fonts, margins or colors).
- [ ] Logging out, then requesting something in the app: the platform's login page appears; after
      logging in, the user is back on the same URL.
- [ ] A write after the dev server restarted (stale CSRF token) succeeds after the 419 retry.
- [ ] Logging in as a different user shows no data from the previous user.
- [ ] Public endpoints answer without a cookie (`curl`); protected ones answer 401.

### Requirements checklist

- [ ] `src/platform/contract.ts` copied, platform commit noted; `embed.ts` exports `mount` and
      `contractVersion`
- [ ] everything created per mount; unmount removes app, router listener, UI library, global
      listeners, timers, requests in flight, theme stylesheet and all DOM
- [ ] no login, logout, profile, user management, top bar or auth guards left
- [ ] router uses `createWebHistory(ctx.routerBase)`; API uses `ctx.apiBase`
- [ ] `X-XSRF-TOKEN` on writes; 401 → `ctx.onUnauthorized()` once; 419 → refresh and retry once
- [ ] all CSS scoped to the app's root (PostCSS step), theme variables scoped, overlays attached
      inside the root
- [ ] storage keys, store ids and CSS variables prefixed with the app id
- [ ] root `height: 100%` with its own scrolling; nothing fixed to the viewport
- [ ] `<ediarum-home>` and `<ediarum-user-menu>` in the header on every screen; `isCustomElement`
      set for `ediarum-` tags
- [ ] Vite: `base: '/apps/<id>/'`, entry `src/embed.ts`, `preserveEntrySignatures`, `embed.js`,
      CSS injected by JS
- [ ] container: `embed.js` `no-cache`, `assets/*` immutable, everything else 404
- [ ] backend: no users or sessions; protected router checks `verify` via `AUTH_VERIFY_URL`;
      answers mapped as in the auth contract; public endpoints explicit and read-only
- [ ] roles checked in the backend where needed; project data stores the project slug and is
      only listed and returned for members of the project and admins; per-user data keyed by email
- [ ] errors JSON, no redirects on 401, no stack traces in responses
- [ ] migrations run at container start
- [ ] entry in `apps.json`

---

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| "… is currently unavailable." | `entry` doesn't return JavaScript. Open the `entry` URL directly: if it returns HTML, nothing serves `/apps/<id>/` (locally: `EDIARUM_DEV_BUNDLES` not set, or the platform not restarted after setting it); if 404, the build hasn't run. Details are in the browser console (`[ediarum.platform] <id>:`). |
| "… is incompatible with this platform version (contract …, expected …)." | `contractVersion` missing or different: the bundler dropped the exports (`preserveEntrySignatures`), or the contract copy is outdated. |
| "… could not be started: its module does not export a mount function." | `mount` missing from the exports; see the previous row. |
| "… failed to start." | `mount` threw. The error is in the browser console. |
| Every request answers 500 | Backend problem, e.g. database migrations not run. Check the backend log. |
| Every request answers 503 | The backend can't reach `verify` (`AUTH_VERIFY_URL` wrong, provider down). |
| Every write answers 419 | `X-XSRF-TOKEN` not sent, not forwarded to `verify`, or the 419 retry is missing. |
| Login loop: the app opens, then the login page appears | The backend answers 401 even though the user is logged in: `Cookie` not forwarded to `verify`, or the app runs on another host than the platform. |
| Chunks or fonts 404 | `base` isn't `/apps/<id>/`. |
| Platform looks different while the app is open | Unscoped CSS: a reset or theme on `html`, `body`, `:root` or `*`. |
| Dialogs unstyled or behind the top bar | Overlays teleported to `<body>`, outside the scoped root. |
| Back button skips or breaks | The app writes `window.location` or uses hash routing, or touches history after unmount. |
| Data of the previous user after re-login | Module-level state; move it into the per-mount context. |
