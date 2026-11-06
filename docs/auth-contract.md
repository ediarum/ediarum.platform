# Auth contract

The platform has exactly one place where users log in: the **auth provider**. The platform frontend and
every app backend rely on it through this contract, and on nothing else. Today the provider is
ediarum.webdav. Anything that implements this contract can replace it: another Laravel app, an
identity server with a small adapter, or a minimal service for a deployment that hosts a single
app.

There are two sides:

- **Browser side** (`csrf-cookie`, `login`, `logout`, `me`, `password`, `profile`, `projects`):
  called by the platform's login and profile pages, and by app frontends for `projects`.
- **Service side** (`verify`, `service/projects`): called by app backends to find out who sent
  a request, and to get the list of all projects.

Apps never implement login, sessions or user management themselves. An app that should run
"standalone" is deployed as the platform with only that app in `apps.json`, next to an auth
provider.

The platform's client for the browser side is [`src/auth/api.ts`](../src/auth/api.ts) and
[`src/api/client.ts`](../src/api/client.ts). An in-memory reference implementation of both sides
is [`dev/mockBackend.ts`](../dev/mockBackend.ts).

---

## Deployment requirements

- The provider is served on **the same host as the platform**, under **`/api/auth/`**. Session
  cookies are per host; on another host, the browser would not send them with app requests.
- `verify` and `service/projects` must also be reachable from every app backend (over the
  internal network or the public URL).
- The provider and every app backend that calls `service/projects` share a **service token**
  (ediarum.webdav: `SERVICE_TOKEN`). Without a configured token, `service/projects` answers 401.
  A deployment may additionally block `/api/auth/service/` at the public proxy.

## Users

```json
{ "name": "Ada Lovelace", "email": "ada@example.org", "roles": [], "projects": ["schleiermacher"] }
```

| Field | Meaning |
|---|---|
| `name` | Display name, shown in the platform's top bar; the user may change it |
| `email` | Unique, permanent identifier of the user; what app backends get as `X-User` |
| `roles` | Role names defined by the provider. `apps.json` restricts apps by them. Empty for regular users. `admin` has a fixed meaning, see [Projects](#projects) |
| `projects` | Slugs of the [projects](#projects) the user is a member of. Empty if none |

Role names, project slugs and the ASCII-only `email` are sent in HTTP headers, so none of them may
contain commas or line breaks.

The `email` never changes, neither by the user nor by an admin: app backends key per-user data by
`X-User`, and a changed email would orphan that data. Someone who needs a different email gets a
new user, which the apps see as a new person.

## Projects

A project is an edition or research project, for example "Schleiermacher in Berlin". Projects
belong to the platform, not to one app: each app attaches its own data to projects by slug (a
WebDAV project in ediarum.webdav, a library in ediarum.zotero, …). The provider keeps the list of
projects and who is a member of which.

```json
{ "slug": "schleiermacher", "name": "Schleiermacher in Berlin" }
```

| Field | Meaning |
|---|---|
| `slug` | Unique, permanent identifier, `[a-z0-9-]+`. Apps store it; like `email`, it never changes |
| `name` | Display name; may change |

**Access rule** (the same in every app): a user may access a project's data if

- the project's slug is in the user's `projects`, or
- the user has the role **`admin`**: admins may access every project, member or not.

Membership is yes or no; there are no roles per project. A user is a member of few projects
(as a rule one or two, at most about ten), so the list travels in a header.

## Cookies

| Cookie | Attributes | Purpose |
|---|---|---|
| session cookie (any name) | `HttpOnly; Path=/; SameSite=Lax`, `Secure` over HTTPS, **no `Domain`** | identifies the session |
| `XSRF-TOKEN` | readable by JS; `Path=/; SameSite=Lax`, `Secure` over HTTPS, **no `Domain`** | CSRF token, see [CSRF](#csrf) |

Without `Domain`, the cookies belong to exactly the host that set them, which also makes them
work on `localhost` during development. No other service on the host may set cookies with these
names.

## CSRF

Every request with a method other than `GET`, `HEAD` or `OPTIONS` must carry the header
`X-XSRF-TOKEN` with the current value of the `XSRF-TOKEN` cookie. Otherwise the answer is
**419**. This applies to the provider's own endpoints and, through `verify`, to every app
backend.

Clients get a fresh cookie from `GET /api/auth/csrf-cookie`. After a 419, a client fetches a fresh
cookie and retries the request once. The value of `XSRF-TOKEN` is opaque to clients: they echo
it, they don't interpret it. (Laravel encrypts it; the cookie value is what goes in the header.)

## Errors

All responses are JSON (or empty). Errors have a `message`; validation errors (422) also have
`errors`, keyed by field name, with a list of messages per field:

```json
{ "message": "The password is incorrect.", "errors": { "current_password": ["The password is incorrect."] } }
```

Unauthenticated requests get **401**, never a redirect, regardless of the `Accept` header.

---

## Browser side

| Request | Success | Failure |
|---|---|---|
| `GET /api/auth/csrf-cookie` | 204, sets `XSRF-TOKEN` | — |
| `POST /api/auth/login` `{ email, password }` | 200, the [user](#users); sets a new session cookie and a new `XSRF-TOKEN` | 401 or 422 on wrong credentials; 422 or 429 when throttled |
| `POST /api/auth/logout` | 204, ends the session (also when there is none) | — |
| `GET /api/auth/me` | 200, the [user](#users) | 401 |
| `POST /api/auth/password` `{ current_password, password, password_confirmation }` | 204 | 401; 422 with `errors` for these three fields |
| `POST /api/auth/profile` `{ name }` | 200, the updated [user](#users) | 401; 422 with `errors` for `name` |
| `GET /api/auth/projects` | 200, list of [projects](#projects) the user may access, sorted by `name`: their own; **all** projects for admins | 401 |

- Login must issue a **new** session id (no session fixation), and must be rate limited.
- Logout must invalidate the session on the server, not only clear the cookie.
- The provider decides password rules; the platform shows whatever 422 messages it returns.
- `profile` changes only the user's own display name. The provider trims it and rejects an empty
  one (422); other rules (e.g. maximum length) are up to the provider.
- `projects` gives apps the names for the slugs, e.g. for a project selector. It may also be
  called by an app backend with the user's forwarded `Cookie` header, like `verify`.

## Service side

### `verify`

```
GET /api/auth/verify
Cookie: <the Cookie header the app backend received, unchanged>
X-Original-Method: <the method of the original request>
X-XSRF-TOKEN: <the X-XSRF-TOKEN header of the original request, if any>
```

| Answer | When |
|---|---|
| **204**, headers `X-User: <email>`, `X-User-Roles: <roles, comma-separated, may be empty>`, `X-User-Projects: <project slugs, comma-separated, may be empty>` | the session is valid (and, for unsafe methods, the CSRF token matches) |
| **401** | no valid session |
| **419** | `X-Original-Method` is not `GET`/`HEAD`/`OPTIONS` and `X-XSRF-TOKEN` is missing or wrong |

- `verify` is a `GET` and does not itself require a CSRF token. It does not check `Origin` or
  `Referer` (server-to-server calls have neither).
- Missing `X-Original-Method` is treated as `GET`.
- It has no side effects other than what reading a session normally does (e.g. extending its
  lifetime).

### `service/projects`

```
GET /api/auth/service/projects
Authorization: Bearer <service token>
```

| Answer | When |
|---|---|
| **200**, list of projects, sorted by `slug` | the token matches |
| **401** | no token, a wrong token, or none configured in the provider. A session cookie does not count |

```json
[
  {
    "slug": "schleiermacher",
    "name": "Schleiermacher in Berlin",
    "repo_url": "https://gitlab.example.org/telota/schleiermacher-data.git",
    "branch": "main",
    "index_source_of_truth": "xml"
  }
]
```

| Field | Meaning |
|---|---|
| `slug`, `name` | As in [Projects](#projects) |
| `repo_url` | Git repository of the project's data, without credentials. May be `null` if not set yet |
| `branch` | The branch the provider tracks |
| `index_source_of_truth` | Where ediarum.index takes the project's data from: `xml` (the XML in the repository) or `app` (the index app itself) |

- The registry of **all** projects, not filtered by any user, so a backend can use it without a
  request from a user (startup, scheduled jobs). For a user's view, filter it by the slugs in
  `verify`'s `X-User-Projects` (all projects for `admin`, see [the access rule](#projects)).
- Browsers never call it; the token must not reach a frontend.

---

## Using the contract in an app backend

An app backend needs one setting, the URL of `verify`, e.g.
`AUTH_VERIFY_URL=http://webdav/webdav/api/auth/verify`; one that uses the project registry also
the [service token](#serviceprojects). For every request to an endpoint that needs a user:

1. Call `verify` with the request's `Cookie` header, its method as `X-Original-Method`, and its
   `X-XSRF-TOKEN` header if present. Use a short timeout (a few seconds) and a shared HTTP client
   with keep-alive.
2. Map the answer:
   - 204 → proceed; the user is `X-User`, the roles are `X-User-Roles` and the projects
     `X-User-Projects`, each split by `,` (empty string → none).
   - 401 → answer 401.
   - 419 → answer 419.
   - anything else, timeout or connection error → answer 503 and log it. **Never** treat a failed
     `verify` as logged in.
3. Check roles for the endpoint, if any, and answer 403 if they don't match.
4. For data that belongs to a project, apply the [access rule](#projects): allowed if the slug is
   in the user's projects or the user has the role `admin`; otherwise 403 (or 404, to not reveal
   that it exists). Lists show only accessible items.

Public endpoints (e.g. read-only data for external clients) simply skip this.

Rules:

- Don't keep users, passwords, sessions, projects or memberships. If the app needs per-user
  data, key it by `X-User` (the email); data that belongs to a project stores the project's slug.
- Don't set cookies on the platform host, and in particular none named like the provider's.
- Optional caching: a `verify` result may be cached for a few seconds for `GET` requests, keyed
  by the full `Cookie` header. Logout then takes that long to reach the app. Never cache for
  other methods: the CSRF check must happen on every write.

In the app's **frontend**, nothing auth-specific is needed beyond the [mount
contract](../src/contract.ts): send requests same-origin to `ctx.apiBase`, echo `XSRF-TOKEN` as
`X-XSRF-TOKEN` on writes (axios does this automatically), call `ctx.onUnauthorized()` on 401, and
after a 419 refresh the cookie (`GET /api/auth/csrf-cookie`) and retry once.

## Developing against the contract

- **Unit tests of an app backend:** stub `verify` (204 with headers, 401, 419, timeout) instead
  of running a provider.
- **The platform's `npm run dev`** implements both sides in memory (`dev/mockBackend.ts`, users
  `ada@example.org` and `admin@example.org`, password `password`; service token
  `dev-service-token`). Its mock app backends under
  `/api/<id>/` go through the same `verify` logic, so it shows the expected behavior end to end.
- **Real app backend with the mock provider:** start it with
  `AUTH_VERIFY_URL=http://localhost:5173/api/auth/verify` and run the platform's `npm run dev` with
  `EDIARUM_DEV_BACKENDS=<id>=<backend URL>`; the browser then reaches everything through
  `localhost:5173` (platform README, "Testing a real app locally").
- **Real provider:** a local stack behind one reverse proxy (same host for platform, provider and
  app), with the platform's `npm run dev:proxy` pointed at it.
