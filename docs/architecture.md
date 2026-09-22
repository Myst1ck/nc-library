# Architecture

Single-user, client-only PWA. No backend of its own: Nextcloud is the storage and identity provider, the browser is the entire application runtime.

## Module map

### `src/lib/`

| File | Responsibility |
| --- | --- |
| `oauth.ts` | OAuth2 authorization-code + PKCE (S256) helpers: verifier/challenge generation, authorize-URL builder, code exchange, token refresh, and `localStorage`/`sessionStorage` persistence. |
| `nextcloud.ts` | Authenticated fetch wrappers. `ncFetch` attaches `Authorization: Bearer`, refreshes once on 401 and retries; `ocsFetch` adds `OCS-APIRequest: true`. Also stores the resolved user id. |
| `dav.ts` | WebDAV client rooted at `/remote.php/dav/files/{user}/{folder}/`. `listFolder` (PROPFIND Depth 1, parsed with `DOMParser`), `downloadFile` (GET), `uploadFile` (PUT), `mkdir` (MKCOL, recursive), `readSidecar`/`writeSidecar`. |
| `pdf.ts` | PDF.js wrapper: `loadDocument`, `renderPage` (devicePixelRatio-scaled canvas), `extractMetadata`, `renderCover` (page 1 → PNG data URL). |
| `progress.ts` | Progress sidecar model: `parseProgress`, `mergeProgress` (last-write-wins), `loadProgress`, debounced `saveProgress` (2 s), `flushProgress`, per-browser `getDeviceId`. |
| `offline.ts` | IndexedDB `nc-book-pwa` (`covers`, `pdfs` stores), PDF cache get/put/remove, `isOnline`, and the localStorage progress-replay queue (`queueProgress`, `flushQueue`). |

### `src/stores/` (Pinia)

| Store | Responsibility |
| --- | --- |
| `auth.ts` | Login orchestration: persist server + client id, run PKCE, handle the redirect callback, resolve the user via OCS, logout. |
| `library.ts` | Scan the `Books` folder, filter PDFs, hydrate cached covers, read progress sidecars, generate covers (6 eager, rest in background). |
| `reader.ts` | Open a book (cache-first, then WebDAV download + cache), restore last page, record page turns (online → debounced PUT, offline → queue), reset on close. |

### Views and components

| File | Responsibility |
| --- | --- |
| `views/LoginView.vue` | Server URL + client ID form; handles the OAuth `?code=` callback and redirect-back. |
| `views/LibraryView.vue` | Grid of `BookCard`s, upload button, loading/error/empty states. |
| `views/ReaderView.vue` | Reader chrome (title/author, offline badge), mounts `PdfViewer`, flushes pending progress on unmount. |
| `views/SettingsView.vue` | Account info, library-folder field, PWA install prompt, logout. |
| `components/UploadButton.vue` | File picker → `uploadFile` (PDF only). |
| `components/BookCard.vue` | Cover, title, progress bar; navigates to `/read/:id`. |
| `components/PdfViewer.vue` | Canvas renderer with prev/next, render cancellation, `page-change` emit. |
| `router/index.ts` | Routes `/`, `/login`, `/read/:id`, `/settings`; auth guard redirects unauthenticated users to login and preserves the OAuth code. |

## Data flow

```
LoginView
  └─ auth.login(server, clientId)
       ├─ saveServer / saveClientId
       ├─ generateCodeVerifier → sessionStorage
       ├─ generateCodeChallenge (S256)
       └─ window.location = /index.php/apps/oauth2/authorize?...
            ↓ (Nextcloud consent)
       redirect back with ?code=
  └─ auth.handleRedirect()
       ├─ exchangeCode → tokens → localStorage
       ├─ ocsFetch /ocs/v2.php/cloud/user → user id
       └─ history.replaceState (strip ?code)

LibraryView
  └─ library.scan()
       ├─ dav.listFolder('')            → PROPFIND, filter *.pdf
       ├─ IndexedDB covers lookup
       ├─ dav.readSidecar(book)         → progress per book
       └─ pdf.renderCover (lazy)        → cache cover in IndexedDB

ReaderView
  └─ reader.open(bookId)
       ├─ offline.getCachedPdf          → hit: fromCache = true
       │   miss: dav.downloadFile → offline.cachePdf
       ├─ pdf.loadDocument
       ├─ progress.loadProgress         → restore lastPage
       └─ pdf.extractMetadata
  └─ PdfViewer page-change
       └─ reader.setPage
            ├─ online  → progress.saveProgress (debounced 2 s PUT)
            └─ offline → offline.queueProgress (localStorage)
```

All WebDAV/OCS calls funnel through `ncFetch`, so bearer auth and the 401-refresh-retry live in one place.

## Progress sidecar schema

One JSON file per book, stored next to the PDF:

```
Books/novels/dune.pdf
Books/novels/dune.progress.json
```

```json
{
  "lastPage": 42,
  "totalPages": 512,
  "updatedAt": "2026-09-21T10:15:00.000Z",
  "deviceId": "3f2c…"
}
```

- `lastPage` / `totalPages` — finite numbers; a payload missing either is rejected by `parseProgress`.
- `updatedAt` — ISO-8601 string. Merge compares these lexically, so **latest `updatedAt` wins**.
- `deviceId` — stable per-browser UUID, used to attribute writes.

Write path: page turns call `saveProgress`, which stores the latest payload and (re)arms a **2 s trailing debounce**; rapid page turns collapse into one PUT. `flushProgress` forces an immediate write (called on reader unmount). A failed PUT is logged, not thrown — offline writes are handled by the queue.

## Offline strategy

**IndexedDB** — database `nc-book-pwa`:

- `covers` — book id → page-1 PNG data URL (owned by the library store).
- `pdfs` — book id → raw `ArrayBuffer` (owned by the offline module).

The DB is opened without an explicit version so a higher version opened elsewhere never triggers a downgrade; the `upgrade` callback creates both stores idempotently.

**Service worker** (`vite-plugin-pwa` / Workbox):

- Precache: `**/*.{js,css,html,png,svg,webmanifest}`.
- Runtime: WebDAV `GET` → `CacheFirst` (`nc-dav-files`, 200 entries, 30 days). The URL pattern uses a negative lookahead so **`.progress.json` sidecars are excluded** — reading position is never served stale.
- Runtime: Nextcloud previews → `StaleWhileRevalidate` (`nc-previews`, 300 entries, 7 days).

**Progress queue** — while offline, page turns append to `localStorage` key `nc-book-pwa.progressQueue` (one entry per book, newest replaces older). `flushQueue` runs on the window `online` event and at reader startup: for each entry it reads the server sidecar, keeps whichever side is newer, PUTs only when the local entry wins, and drops entries the server already superseded. Entries that still fail stay queued.

## Auth flow

```
1. authorize   GET  {server}/index.php/apps/oauth2/authorize
                    ?response_type=code&client_id=…&redirect_uri=…
                    &code_challenge=…&code_challenge_method=S256
2. exchange    POST {server}/apps/oauth2/api/v1/token
                    grant_type=authorization_code&code=…&code_verifier=…
                    → { access_token, refresh_token, expires_in }
3. use         ncFetch  → Authorization: Bearer <access_token>
               ocsFetch → + OCS-APIRequest: true
4. refresh     on 401: POST /apps/oauth2/api/v1/token
                    grant_type=refresh_token&refresh_token=…
                    → retry the original request once, then throw
```

Concurrent 401s share a single in-flight refresh (`refreshInFlight`). If no refresh token, server or client id is available, the refresh is skipped and the request throws.

## Known limitations

- **PDF only.** EPUB and other formats are not supported; the library filters to `*.pdf`.
- **Single-user.** One server, one account, one token set per browser profile. No multi-account switching.
- **CORS needs a proxy.** Cross-origin deployments require the reverse-proxy headers documented in the README; Nextcloud does not send them by default.
- **Folder override applies on reload.** Settings persists `nc-book-pwa.folder`; when the DAV helpers are called without an explicit folder argument, `dav.ts` reads that value and falls back to `DEFAULT_FOLDER` (`Books`). Changes take effect on the next reload, not immediately.
- **App-password auth unsupported.** The only auth path is OAuth2 Bearer; there is no Basic-auth or manual-token entry.
- **No server-side conflict resolution.** Progress merge is client-side last-write-wins on `updatedAt`; clock skew between devices can pick the "wrong" winner.
- **Cover generation downloads the full PDF.** Covers are rendered client-side from the PDF bytes, so first scan transfers each book once.