# SETUP.md — nc-book-pwa bring-up

Single-service project: a static Vue 3 + Vite PWA. No backend, no database — the user's Nextcloud instance is the backend (OAuth2 PKCE + WebDAV + OCS). Docker mode is **not available** (no compose file, no Dockerfile); local mode only.

## Services

| Service | Command | Port | URL |
|---|---|---|---|
| Vite dev server | `npm run dev -- --host` | 5174 | http://localhost:5174/ |

Hostname access: `server.allowedHosts: ['brain']` in `vite.config.ts` allows the Tailscale hostname `brain`. Add more hostnames there if needed.

Dev proxy: `server.proxy` forwards Nextcloud paths (`/remote.php`, `/ocs`, `/index.php`, `/apps`, `/login`, `/logout`, `/status.php`) to `NC_ORIGIN` (default `http://100.120.43.78:8989` — traefik's plain-http web entrypoint on the Nextcloud host; skipping Tailscale serve avoids the `X-Forwarded-Proto: https` header that made NC emit `https://` absolute URLs), so the browser talks to Nextcloud same-origin and CORS is avoided. Override the target with the `NC_ORIGIN` env var. Nextcloud now lives under `/cloud` on that host: unprefixed app paths are rewritten to `/cloud/...`, while `/cloud/...` paths pass through untouched (NC's own redirects carry the prefix). In dev, enter `http://brain:5174` as the Nextcloud server URL in the app's login form (`http://brain:5174/cloud` also works). `secure: false` disables upstream cert verification — dev-only.

`npm run preview` (serves a production build) also binds 5174 — never run both at once.

## Prerequisites

- Node.js (any recent LTS; Vite 6)
- Dependencies: `npm install` (check with `ls node_modules/.bin/vite`)

## Env vars

None required. The Nextcloud server URL and OAuth2 client ID are entered in the app's login screen and stored in `localStorage` (tokens too; PKCE verifier transient in `sessionStorage`). No `.env` file exists or is needed.

## Install + start (local mode)

```bash
npm install
npm run dev -- --host   # dev server on all interfaces (localhost + LAN + Tailscale)
```

Production check:

```bash
npm run typecheck    # vue-tsc --noEmit
npm run build        # vue-tsc && vite build → dist/
npm run preview      # serves dist/ on http://localhost:5174/
```

## Docker mode

Not available — no `docker-compose.yml` / `Dockerfile` in the repo. `/up docker` should refuse and fall back to local.

## Health checks

- `GET http://localhost:5174/` → **200**, HTML containing `<title>NC Book PWA</title>` and a link to `manifest.webmanifest`
- `GET http://localhost:5174/manifest.webmanifest` → **200**

A healthy Vite startup log shows `VITE v6.x ready in …` and `Local: http://localhost:5174/`.

## External dependency: your Nextcloud

The app talks to a Nextcloud instance you must have running and reachable from the browser:

1. **Register an OAuth2 client**: Nextcloud → *Settings → Security → OAuth 2.0* → new client. Redirect URI must be the PWA origin **with trailing slash** (dev: `http://localhost:5174/`). PKCE S256. Copy **both** the client ID and the client secret into the app's login screen — Nextcloud requires the secret on token requests (no public-client mode).
2. **CORS**: cross-origin calls to WebDAV/OCS are blocked by default. Either add CORS headers at a reverse proxy in front of Nextcloud, or serve the PWA same-origin with Nextcloud (subpath/subdomain — simplest). See README §CORS.
3. **HTTPS in production**: PKCE redirects and service-worker registration need a secure origin (`localhost` exempt for dev).

## Manual steps remaining after bring-up

- Have a reachable Nextcloud instance with the OAuth2 client registered (step 1 above).
- Books live in a `Books` folder on Nextcloud WebDAV by default (override in app Settings).
