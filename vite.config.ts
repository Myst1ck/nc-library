import { defineConfig, type ProxyOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// Vite does not re-export the http-proxy server type, so derive it from the
// `configure` hook signature.
type ProxyServer = Parameters<NonNullable<ProxyOptions['configure']>>[0]

// Target traefik's plain-http web entrypoint on the Nextcloud host. Skips
// Tailscale serve, so NC never sees `X-Forwarded-Proto: https` and generates
// same-origin absolute URLs. Override with the NC_ORIGIN env var.
const NC_ORIGIN = process.env.NC_ORIGIN ?? 'http://100.120.43.78:8989'
const NC_HOST = new URL(NC_ORIGIN).host

// NC's absolute redirects carry the routing host Traefik knows (slave FQDN),
// not the NC_ORIGIN host. Both must be stripped so the browser never leaves
// the PWA origin mid-login (state lives in the origin-bound NC session).
const NC_ROUTING_HOST = 'slave.tail7c13f3.ts.net'

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// NC sets `secure` + `path=/cloud` cookies (it sits behind https + a subpath).
// Browser runs on plain http at the PWA origin, so strip `secure` and rewrite
// the cookie path to / — otherwise the NC session dies between requests.
// Also strips the NC host from absolute Location headers so OAuth redirects
// stay on the PWA origin and keep the same cookie session (state survives).
const fixNcCookies = (proxy: ProxyServer): void => {
  proxy.on('proxyRes', (proxyRes) => {
    const cookies = proxyRes.headers['set-cookie']
    if (cookies) {
      proxyRes.headers['set-cookie'] = cookies.map((cookie) =>
        cookie
          .replace(/;\s*secure/i, '')
          .replace(/path=\/cloud(?=[;]|$)/i, 'path=/'),
      )
    }

    const location: string | string[] | undefined = proxyRes.headers.location
    if (location) {
      const hostPattern = new RegExp(
        `^https?://(?:${[NC_HOST, NC_ROUTING_HOST].map(escapeRegex).join('|')})(?=/)`,
        'i',
      )
      const values = Array.isArray(location) ? location : [location]
      const fixed = values.map((value) => value.replace(hostPattern, ''))
      proxyRes.headers.location = Array.isArray(location) ? fixed.join(', ') : fixed[0]
    }
  })
}

export default defineConfig({
  // Served under /library on both dev (brain) and prod (slave) tailscale hosts.
  base: '/library/',
  server: {
    port: 5174,
    allowedHosts: ['brain', 'brain.tail7c13f3.ts.net'],
    proxy: {
      // Nextcloud behind the dev server: same-origin for the browser, no CORS.
      // Override target with NC_ORIGIN env var. All NC entry points proxied so
      // the OAuth redirect chain keeps NC session cookies on this origin.
      // `logLevel` is honored by http-proxy at runtime but missing from Vite's
      // vendored ProxyOptions type, hence the assertion.
      // Nextcloud moved under /cloud on the target host. NC's own redirects come
      // back with the /cloud prefix — pass those through untouched.
      '^/cloud/': {
        target: NC_ORIGIN,
        changeOrigin: false,
        secure: false,
        logLevel: 'warn',
        // Traefik routes by Host header; force slave FQDN so ingress nextcloud-ts matches.
        headers: { host: 'slave.tail7c13f3.ts.net' },
        configure: fixNcCookies,
      } as ProxyOptions,
      // App calls unprefixed NC paths (server URL = PWA origin); rewrite adds /cloud.
      '^/(remote\\.php|ocs|index\\.php|apps|login|logout|status\\.php)': {
        target: NC_ORIGIN,
        changeOrigin: false,
        secure: false,
        logLevel: 'warn',
        headers: { host: 'slave.tail7c13f3.ts.net' },
        rewrite: (path) => path.replace(/^\/(?=remote\.php\/|ocs\/|index\.php\/|apps\/|login\/|logout\/|status\.php)/, '/cloud/'),
        configure: fixNcCookies,
      } as ProxyOptions,
    },
  },
  preview: { port: 5174 },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      // Manifest is hand-authored at public/manifest.webmanifest and linked in index.html.
      manifest: false,
      // PWA needs a secure context; dev is served over HTTPS via tailscale serve.
      devOptions: { enabled: true },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        runtimeCaching: [
          {
            // PDF downloads from WebDAV. The negative lookahead keeps progress
            // sidecars (`.progress.json`) out of the cache so reading position
            // is never served stale.
            urlPattern: /\/remote\.php\/dav\/(?!.*\.progress\.json).*/i,
            method: 'GET',
            handler: 'CacheFirst',
            options: {
              cacheName: 'nc-dav-files',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Nextcloud previews / thumbnails (covers).
            urlPattern: /\/index\.php\/core\/preview.*/i,
            method: 'GET',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'nc-previews',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 7
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ]
})