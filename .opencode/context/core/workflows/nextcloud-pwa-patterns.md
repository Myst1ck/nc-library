# Nextcloud PWA Patterns — nc-book-pwa

Project-specific. Applies to static PWA + Nextcloud WebDAV/OAuth2 stack.

## OAuth2 PKCE flow shape
- `authorize` → redirect to Nextcloud `/index.php/apps/oauth2/authorize` with `code_challenge`.
- Exchange `code` + `code_verifier` for token at `/index.php/apps/oauth2/api/v1/token`.
- Send `Authorization: Bearer <token>` on all API/DAV calls.
- Validate `state` param on redirect callback (CSRF guard).
- Central `ncFetch`: on 401 → refresh token once, retry original request.

## WebDAV progress sidecar
- Progress file: `<book>.progress.json` next to the book.
- Fields: page/percent/`updatedAt`. Merge = last-write-wins by `updatedAt`.
- Write debounce 2s; flush on `pagehide` + `visibilitychange` (hidden).
- On PUT failure: re-queue to offline queue; retry when back online.

## IndexedDB
- DB name `nc-book-pwa`; stores `covers` + `pdfs`.
- Upgrade handler idempotent — same schema declared in `library.ts` AND `offline.ts`.
- Guard `onupgradeneeded` with `if (!db.objectStoreNames.contains(...))`.

## Service worker
- `runtimeCaching`: exclude `.progress.json` from cache (always network).
- Cache shell + static assets; never cache auth/DAV writes.

## Deployment
- Nextcloud host needs CORS allow for the static PWA origin.
- No server install; reverse proxy recommended (same-origin avoids CORS entirely).
