# NC Book PWA

A single-user, offline-capable **PDF book library** that runs entirely in the browser and stores everything in **your own Nextcloud**. The app is a static PWA: it authenticates against Nextcloud with OAuth2 + PKCE, lists and downloads PDFs over WebDAV, renders them with PDF.js, and syncs reading position across devices through a small JSON sidecar file written next to each book. No server component, no database, no third-party service — your Nextcloud is the backend.

## Features

- Library grid of every PDF in your Nextcloud library folder (`Books` by default; override in Settings, applied on reload), with generated page-1 covers.
- PDF reading with page navigation (PDF.js).
- Cross-device reading progress via `<book>.progress.json` sidecars (last-write-wins).
- Offline reading: PDFs cached in IndexedDB; progress writes queued and replayed on reconnect.
- Installable PWA (standalone display, service worker, app icons).

## Requirements

- Node.js 20+ and npm.
- A Nextcloud instance reachable over HTTPS.
- An OAuth2 client registered in Nextcloud (see below).

## Setup

```bash
npm install
npm run dev        # Vite dev server
npm run build      # vue-tsc type-check + production build -> dist/
npm run preview    # serve the production build locally
npm run typecheck  # vue-tsc --noEmit
```

Open the dev server URL, enter your Nextcloud server URL and OAuth2 client ID, and sign in.

## Nextcloud OAuth2 client registration

1. In Nextcloud, go to **Settings → Security → OAuth 2.0**.
2. Register a new client.
3. Set the **redirect URI** to the PWA origin, including the trailing slash — e.g. `https://books.example.com/`. The app always redirects to `${window.location.origin}/`, so the registered URI must match exactly.
4. Copy the generated **client ID** into the app's login screen. No client secret is used (public client + PKCE S256).

The app stores the server URL, client ID and tokens in `localStorage`; the transient PKCE verifier lives in `sessionStorage` for the redirect round-trip only.

## App-password fallback (older Nextcloud)

The current code path is **OAuth2 Bearer only** — `ncFetch` always sends `Authorization: Bearer <accessToken>`, and there is no Basic-auth or app-password input in the UI. If your Nextcloud predates the OAuth2 app (or OAuth2 is disabled), the app cannot authenticate as-is. Options:

- **Upgrade / enable OAuth2** in Nextcloud (recommended).
- **Reverse-proxy Basic auth**: terminate an app password at a proxy in front of Nextcloud and inject the `Authorization: Basic` header there. The browser still talks OAuth2 to the app; the proxy handles the legacy credential. This is a deployment workaround, not an app feature.
- **Manual token entry**: not implemented. There is no field to paste an app password or access token.

Documented honestly: app-password login is **not** supported by the app itself today.

## CORS

A static PWA served from one origin calling Nextcloud WebDAV/OCS on another origin is a cross-origin request. Nextcloud does not send permissive CORS headers by default, so the browser blocks the calls unless you add them at a reverse proxy in front of Nextcloud.

Required response headers (replace `https://books.example.com` with your PWA origin):

```
Access-Control-Allow-Origin: https://books.example.com
Access-Control-Allow-Methods: GET, PUT, PROPFIND, MKCOL, OPTIONS
Access-Control-Allow-Headers: Authorization, OCS-APIRequest, Content-Type, Depth
Access-Control-Max-Age: 86400
```

`OPTIONS` preflight must be answered with `204`/`200` and the headers above, without proxying to Nextcloud.

### Caddy

```caddy
cloud.example.com {
    @cors {
        header Origin https://books.example.com
    }
    handle @cors {
        header {
            Access-Control-Allow-Origin  "https://books.example.com"
            Access-Control-Allow-Methods "GET, PUT, PROPFIND, MKCOL, OPTIONS"
            Access-Control-Allow-Headers "Authorization, OCS-APIRequest, Content-Type, Depth"
            Access-Control-Max-Age       86400
        }
        @preflight method OPTIONS
        respond @preflight 204
        reverse_proxy 127.0.0.1:8080
    }
    reverse_proxy 127.0.0.1:8080
}
```

### nginx

```nginx
map $http_origin $cors_origin {
    default "";
    "https://books.example.com" $http_origin;
}

server {
    listen 443 ssl;
    server_name cloud.example.com;

    location / {
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin  $cors_origin always;
            add_header Access-Control-Allow-Methods "GET, PUT, PROPFIND, MKCOL, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Authorization, OCS-APIRequest, Content-Type, Depth" always;
            add_header Access-Control-Max-Age       86400 always;
            return 204;
        }

        add_header Access-Control-Allow-Origin  $cors_origin always;
        add_header Access-Control-Allow-Methods "GET, PUT, PROPFIND, MKCOL, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, OCS-APIRequest, Content-Type, Depth" always;

        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }
}
```

### Same-domain fallback (no CORS)

Serve the PWA from the **same origin** as Nextcloud — e.g. a subpath (`https://cloud.example.com/books/`) or a subdomain routed through the same proxy. Same-origin requests need no CORS headers at all. This is the simplest deployment if you control the Nextcloud host.

## Deploy

1. `npm run build` → static assets in `dist/`.
2. Host `dist/` on any static host (nginx, Caddy, GitHub Pages, Netlify, S3, …).
3. **HTTPS is required**: PKCE redirects and service-worker registration only work on secure origins (`localhost` is exempt for development).
4. The service worker and manifest are generated by `vite-plugin-pwa`; the manifest is hand-authored at `public/manifest.webmanifest` and linked from `index.html`. Icons live at `public/icons/icon-192.png` and `public/icons/icon-512.png`.
5. Configure CORS (above) or use the same-domain layout.

## Manual verification checklist

- [ ] **Login flow** — enter server URL + client ID, get redirected to Nextcloud, approve, land back in the library authenticated.
- [ ] **Upload** — upload a PDF; it appears in the grid with a generated cover.
- [ ] **Cross-device progress** — read to page N on device A; open the same book on device B and resume at page N.
- [ ] **Airplane-mode offline** — open a book once (caches it), go offline, reopen it; it loads from cache and page turns are queued.
- [ ] **PWA install** — install from the browser; the app launches standalone and loads offline.