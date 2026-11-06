# ediarum.platform

The single browser entry point for the ediarum services at BBAW. The platform owns the top menu,
login and profile page, and mounts the frontends of ediarum.webdav, ediarum.zotero and
ediarum.index at runtime into its content area.

- Vue 3, TypeScript (strict), Vite, vue-router 4, Pinia; plain CSS with `--ep-` custom properties
- The list of apps is a JSON file ([`apps.json`](#configuration-appsjson)), not code
- Apps implement the mount contract in [`src/contract.ts`](src/contract.ts); see
  [docs/integrating-an-app.md](docs/integrating-an-app.md)
- Login is provided by an auth provider (today ediarum.webdav) that implements
  [docs/auth-contract.md](docs/auth-contract.md); app backends check users through it, so no app
  has a login of its own

## Setup

Requires Node 24 (see `.nvmrc`; `nvm use`) and npm.

```sh
npm ci
npm run dev
```

Open <http://localhost:5173/> and log in with one of the mock users:

| Email | Password | Roles |
|---|---|---|
| `ada@example.org` | `password` | none |
| `admin@example.org` | `password` | `admin` |

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with mock auth backend, mock app backends and the mock app |
| `npm run dev:proxy` | Dev server that forwards `/api` and `/apps` to a real stack |
| `npm run build` | Type-check and build to `dist/` |
| `npm run check` | Type-check, lint and unit tests (run before every commit) |
| `npm run test` / `test:watch` | Unit tests (Vitest, jsdom) |
| `npm run lint` | ESLint |

### `npm run dev`: mocks

Everything runs inside the Vite dev server ([`dev/devPlugin.ts`](dev/devPlugin.ts)), with no extra
dependencies or processes:

- **`/config/apps.json`** is served from [`dev/apps.json`](dev/apps.json) (zotero, webdav,
  index), or from the file in `EDIARUM_APPS_JSON`. Apps without a local bundle (see
  [Testing a real app locally](#testing-a-real-app-locally)) show "currently unavailable". To see
  the mock app, add `{ "id": "mock", "label": "Mock", "entry": "/apps/mock/embed.js",
  "apiBase": "/api/mock", "roles": [] }`.
- **Mock auth backend** ([`dev/mockBackend.ts`](dev/mockBackend.ts)): implements the
  [auth contract](docs/auth-contract.md) in memory, including `verify` and the XSRF cookie/header check (419 on
  mismatch). State resets when the dev server restarts.
- **Mock app backends:** `/api/<id>/…` runs the same check as `verify`, like a real app backend:
  401 without a session, 419 on writes without a valid XSRF token, otherwise a JSON echo with the
  `X-User` headers that `verify` returned.
- **Mock app** ([`dev/mock-app/`](dev/mock-app/)): a minimal app implementing the contract, with
  internal routes, a display of the `ctx` it received, a global key listener (to check cleanup)
  and buttons to call its API and simulate a 401. It is built with its own Vite config in watch
  mode, like a real app, and served from `/apps/mock/`. Serving a real bundle (its own Vue
  and vue-router, loaded with native `import()`) tests the same code paths as production.

### `npm run dev:proxy`: against a real stack

```sh
EDIARUM_PROXY_TARGET=http://localhost:8080 npm run dev:proxy
```

`/api/…` and `/apps/…` are forwarded to `EDIARUM_PROXY_TARGET` (for example the reverse
proxy of a local compose stack). `apps.json` is read from `EDIARUM_APPS_JSON` (default:
`public/config/apps.json`). Both variables can also go in `.env.proxy.local`.

The browser talks to `localhost:5173`, so session and XSRF cookies must not be set with a
`Domain` attribute (see [the auth contract](docs/auth-contract.md#cookies)).

### Testing a real app locally

`EDIARUM_DEV_BACKENDS` and `EDIARUM_DEV_BUNDLES` point single apps at services running on your
machine, while everything else stays mocked (`npm run dev`) or proxied (`npm run dev:proxy`).
Everything is reached through `localhost:5173`, so the session cookie works for all of it.
Details: [`dev/appOverrides.ts`](dev/appOverrides.ts).

| Variable | Value | Effect |
|---|---|---|
| `EDIARUM_DEV_BACKENDS` | `<id>=<URL>` | `/api/<id>/…` → `<URL>/…` (prefix stripped, as in production) |
| `EDIARUM_DEV_BUNDLES` | `<id>=<directory>` | `/apps/<id>/…` → files of a build, e.g. from `vite build --watch` |
| `EDIARUM_DEV_BUNDLES` | `<id>=<URL>` | `/apps/<id>/…` → the app's Vite dev server, with hot reload; `embed.js` is served from its `src/embed.ts` |

Several apps are separated by commas. The variables can also go in `.env.local`
(`.env.proxy.local` for `dev:proxy`).

Example: ediarum.zotero with the mock login. Its backend gets
`AUTH_VERIFY_URL=http://localhost:5173/api/auth/verify`.

```sh
# 1. zotero backend
cd ../ediarum.zotero && uv run fastapi dev app/core/main.py --port 8004

# 2a. zotero frontend, with hot reload (its Vite base must be /apps/zotero/ in dev too)
cd ../ediarum.zotero/frontend && npx vite --port 5174
# 2b. or as a build, closest to production
cd ../ediarum.zotero/frontend && npx vite build --watch

# 3. platform
EDIARUM_DEV_BACKENDS=zotero=http://localhost:8004 \
EDIARUM_DEV_BUNDLES=zotero=http://localhost:5174 \
npm run dev
# (for 2b: EDIARUM_DEV_BUNDLES=zotero=../ediarum.zotero/frontend/dist)
```

Then open <http://localhost:5173/zotero/>. The dev server form differs from production in how CSS
is injected and in chunking, and hot updates keep module state that a real remount would reset:
check with the build form before deploying.

## Configuration: `apps.json`

At startup the platform fetches `/config/apps.json`. The file is
[`public/config/apps.json`](public/config/apps.json), committed and copied into every build,
so adding or changing an app means a commit and a deploy.

```json
[
  { "id": "zotero", "label": "Zotero", "entry": "/apps/zotero/embed.js", "apiBase": "/api/zotero", "roles": [] }
]
```

| Field | Meaning |
|---|---|
| `id` | URL segment `/<id>/…`; `[a-z0-9-]+`; not `login`, `profile`, `api`, `apps`, `config`, `assets` |
| `label` | Menu text |
| `entry` | URL of the app's ES module |
| `apiBase` | Passed to the app as `ctx.apiBase` |
| `roles` | If non-empty, only users with at least one of these roles see and can open the app |

The file is validated on load ([`src/config/validateApps.ts`](src/config/validateApps.ts)). If it
is missing or invalid, the platform shows an error page listing every problem.

## Behavior

- **Routes:** `/login` (public), `/profile`, `/<id>/…` for each app, `/` → default target, anything
  else → "not found". Logged-out users are sent to `/login?next=<path>`.
- **`next`** only accepts router-internal paths of known routes (no `//…`, `://`, backslashes,
  control characters, also after percent-decoding); anything else is ignored.
- **Default target** after login and at `/`: valid `next` → last used app (from `localStorage`)
  if still accessible → first accessible app → `/profile`.
- **401 anywhere** (platform API calls, or an app calling `ctx.onUnauthorized()`): the user is
  cleared, the app unmounted, and the login page returns to the current URL afterwards.
- **App hosting** ([`src/components/AppHost.vue`](src/components/AppHost.vue)): loading state;
  contract version check; "currently unavailable" with a retry button on load errors. Switching
  apps or users fully unmounts the previous app; navigating inside an app does not remount it.
- **Shared history:** the platform router and the app's router both use `window.history`.
  [`src/router/history.ts`](src/router/history.ts) keeps them from corrupting each other's
  history entries, so back/forward work across and within apps.
- **UI text** is English and lives in [`src/strings.ts`](src/strings.ts), so another language can
  be added later.

## Auth

The contract with the auth provider is [docs/auth-contract.md](docs/auth-contract.md). The platform
uses its browser side (`csrf-cookie`, `login`, `logout`, `me`, `password`, `profile`); app backends use
`verify`. All the platform's auth calls live in [`src/auth/api.ts`](src/auth/api.ts); the CSRF
handling lives in [`src/api/client.ts`](src/api/client.ts): every non-GET request sends the
`XSRF-TOKEN` cookie value as `X-XSRF-TOKEN`. If the cookie is missing, the client fetches it
first; on 419 it refreshes the cookie and retries once.

## Deployment

The platform has its own host, `platform.ediarum.org`, separate from the public ediarum website, so
the browser keeps the platform's cookies and scripts isolated from it. The platform is served at the
root of that host, behind a reverse proxy that routes the paths below.

The platform is static files: `npm run build` writes them to `dist/`, `apps.json` included. It
does not care what serves them, as long as these rules hold:

| Path | `Cache-Control` |
|---|---|
| `/index.html` and SPA fallback (every unknown path → `/index.html`) | `no-cache` |
| `/config/apps.json` (404 if missing) | `no-cache` |
| `/assets/*` | `public, max-age=31536000, immutable` |

There are two ways to deploy it:

- **Behind an existing reverse proxy**: serve `dist/` with any web server that
  follows the table; [`docker/nginx.conf`](docker/nginx.conf) has these rules for nginx. To
  update, copy `dist/assets/` first and `dist/index.html` last, so the new version goes live only
  once all its files are there. Alternatively run the image (`docker build -t ediarum-platform .`), which
  serves `dist/` with exactly these rules. In every case the proxy needs the locations below,
  pointing at wherever ediarum.webdav and the other apps run.

- **The whole stack on one machine** (public version, workshops): [`compose.yaml`](compose.yaml)
  runs the platform, ediarum.webdav (pulled in from its repo with `include`, pinned to a tag)
  and an nginx proxy ([`docker/proxy.conf`](docker/proxy.conf)) on `PROXY_PORT`. TLS, if any,
  is terminated in front of it.

  ```sh
  cp .env.example .env                        # set WEBDAV_COMPOSE to a webdav release tag
  mkdir -p env                                # env/webdav.env: see ediarum.webdav's .env.example
  docker compose up -d --build
  ```

  Over plain HTTP (`http://localhost:8080`) set `SESSION_SECURE_COOKIE=false` in
  `env/webdav.env`, or the browser drops the session cookie.

Public paths on `platform.ediarum.org`:

| Path | Served by |
|---|---|
| `/api/auth/…`, `/api/webdav/…` | ediarum.webdav (Laravel): login/session, and the JSON API of its admin app |
| `/api/<id>/…` | the app's backend; it checks users itself via `/api/auth/verify` |
| `/apps/<id>/…` | the app's frontend bundle (`embed.js`, `assets/`) |
| `/webdav/connection/<slug>/…` | ediarum.webdav: the WebDAV protocol endpoint (HTTP Basic auth, for Oxygen) |
| everything else (`/`, `/login`, `/profile`, `/<id>/…`, `/config/…`, `/assets/…`) | the platform |

[`docker/proxy.conf`](docker/proxy.conf) has the matching locations, with the upstreams of
`compose.yaml`; another proxy needs the same locations with its own upstreams.

nginx prefers the longest matching prefix, so `/webdav/connection/…` goes to ediarum.webdav while
the rest of `/webdav/…` is the platform route of the app with id `webdav`. That app must therefore
never use a route starting with `/connection`. Other apps get plain `location /api/<id>/` and
`location /apps/<id>/` blocks of their own; the proxy does no auth checks.

Changes to `apps.json` take effect with the next deploy. Browsers pick them up on the next page
load (`no-cache`).

## License

ediarum.platform is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

ediarum.platform is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with ediarum.platform. If not, see <https://www.gnu.org/licenses/>.
