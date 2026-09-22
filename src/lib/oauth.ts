/**
 * Nextcloud OAuth2 authorization-code flow with PKCE (S256).
 *
 * Single-user client-side app: tokens, server URL and client id live in
 * localStorage; the transient PKCE verifier lives in sessionStorage so it
 * survives the redirect round-trip but not a fresh tab.
 */

export const TOKENS_STORAGE_KEY = 'nc-book-pwa.tokens'
export const SERVER_STORAGE_KEY = 'nc-book-pwa.server'
export const CLIENT_ID_STORAGE_KEY = 'nc-book-pwa.clientId'
export const CLIENT_SECRET_STORAGE_KEY = 'nc-book-pwa.clientSecret'
export const PKCE_VERIFIER_STORAGE_KEY = 'nc-book-pwa.pkce.verifier'
export const OAUTH_STATE_STORAGE_KEY = 'nc-book-pwa.oauth.state'

export interface NcTokens {
  accessToken: string
  refreshToken: string
  expiresAt?: number
}

interface RawTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  error?: string
  error_description?: string
  message?: string
}

/** Strip whitespace and any trailing slashes from a server base URL. */
export function normalizeServer(server: string): string {
  return server.trim().replace(/\/+$/, '')
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** RFC 7636 code verifier: 32 random bytes -> 43-char base64url string. */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

// SHA-256 round constants (FIPS 180-4).
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0
}

/**
 * Pure-JS SHA-256 (FIPS 180-4).
 *
 * Web Crypto's `crypto.subtle` is only exposed in secure contexts (https or
 * localhost). This app is served over plain HTTP on a LAN hostname, where
 * `crypto.subtle` is undefined, so the PKCE S256 challenge needs a local digest.
 */
function sha256(bytes: Uint8Array): Uint8Array {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])

  const bitLength = bytes.length * 8
  const paddedLength = ((bytes.length + 1 + 8 + 63) & ~63)
  const message = new Uint8Array(paddedLength)
  message.set(bytes)
  message[bytes.length] = 0x80

  // 64-bit big-endian message length in bits.
  const highBits = Math.floor(bitLength / 0x100000000)
  const lowBits = bitLength >>> 0
  message[paddedLength - 8] = (highBits >>> 24) & 0xff
  message[paddedLength - 7] = (highBits >>> 16) & 0xff
  message[paddedLength - 6] = (highBits >>> 8) & 0xff
  message[paddedLength - 5] = highBits & 0xff
  message[paddedLength - 4] = (lowBits >>> 24) & 0xff
  message[paddedLength - 3] = (lowBits >>> 16) & 0xff
  message[paddedLength - 2] = (lowBits >>> 8) & 0xff
  message[paddedLength - 1] = lowBits & 0xff

  const w = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4
      w[i] = ((message[j] << 24) | (message[j + 1] << 16) | (message[j + 2] << 8) | message[j + 3]) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let a = state[0]
    let b = state[1]
    let c = state[2]
    let d = state[3]
    let e = state[4]
    let f = state[5]
    let g = state[6]
    let h = state[7]

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0

      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    state[0] = (state[0] + a) >>> 0
    state[1] = (state[1] + b) >>> 0
    state[2] = (state[2] + c) >>> 0
    state[3] = (state[3] + d) >>> 0
    state[4] = (state[4] + e) >>> 0
    state[5] = (state[5] + f) >>> 0
    state[6] = (state[6] + g) >>> 0
    state[7] = (state[7] + h) >>> 0
  }

  const digest = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    digest[i * 4] = (state[i] >>> 24) & 0xff
    digest[i * 4 + 1] = (state[i] >>> 16) & 0xff
    digest[i * 4 + 2] = (state[i] >>> 8) & 0xff
    digest[i * 4 + 3] = state[i] & 0xff
  }
  return digest
}

/** S256 code challenge for a verifier. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier)
  // `crypto.subtle` is secure-context-only, so use the pure-JS digest over plain HTTP.
  const digest = crypto.subtle
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    : sha256(bytes)
  return base64UrlEncode(digest)
}

/** Random per-login OAuth `state`, used to bind the redirect to this session. */
export function generateOAuthState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export function loadOAuthState(): string | null {
  return sessionStorage.getItem(OAUTH_STATE_STORAGE_KEY)
}

export function saveOAuthState(state: string): void {
  sessionStorage.setItem(OAUTH_STATE_STORAGE_KEY, state)
}

export function clearOAuthState(): void {
  sessionStorage.removeItem(OAUTH_STATE_STORAGE_KEY)
}

/**
 * Build the Nextcloud authorization URL.
 *
 * NOTE: the challenge and state are required arguments — PKCE cannot be formed
 * from the server/client/redirect triple alone, and the verifier/state must be
 * generated and persisted by the caller before this is called.
 */
export function buildAuthorizeUrl(
  server: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string {
  const url = new URL(`${normalizeServer(server)}/index.php/apps/oauth2/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  return url.toString()
}

async function requestToken(server: string, body: Record<string, string>): Promise<NcTokens> {
  // NC OAuth2 requires client_secret on token requests even with PKCE — there is
  // no public-client mode, and a missing secret makes the endpoint 500.
  const secret = loadClientSecret()
  if (secret) {
    body.client_secret = secret
  }

  const response = await fetch(`${normalizeServer(server)}/apps/oauth2/api/v1/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body).toString(),
  })

  const raw = (await response.json().catch(() => ({}))) as RawTokenResponse
  if (!response.ok || !raw.access_token) {
    const message =
      raw.error_description ??
      raw.message ??
      raw.error ??
      `Nextcloud token request failed (${response.status})`
    throw new Error(message)
  }

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? '',
    expiresAt:
      typeof raw.expires_in === 'number' ? Date.now() + raw.expires_in * 1000 : undefined,
  }
}

/** Exchange an authorization code for tokens. */
export function exchangeCode(
  server: string,
  clientId: string,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<NcTokens> {
  return requestToken(server, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })
}

/** Refresh an access token. Keeps the previous refresh token if none is returned. */
export async function refresh(
  server: string,
  clientId: string,
  refreshToken: string,
): Promise<NcTokens> {
  const next = await requestToken(server, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  })
  if (!next.refreshToken) {
    next.refreshToken = refreshToken
  }
  return next
}

export function loadTokens(): NcTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NcTokens>
    if (!parsed.accessToken) return null
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? '',
      expiresAt: parsed.expiresAt,
    }
  } catch {
    return null
  }
}

export function saveTokens(tokens: NcTokens | null): void {
  if (!tokens) {
    localStorage.removeItem(TOKENS_STORAGE_KEY)
    return
  }
  localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(tokens))
}

export function clearTokens(): void {
  localStorage.removeItem(TOKENS_STORAGE_KEY)
}

export function loadServer(): string | null {
  return localStorage.getItem(SERVER_STORAGE_KEY)
}

export function saveServer(server: string): void {
  localStorage.setItem(SERVER_STORAGE_KEY, normalizeServer(server))
}

export function clearServer(): void {
  localStorage.removeItem(SERVER_STORAGE_KEY)
}

export function loadClientId(): string | null {
  return localStorage.getItem(CLIENT_ID_STORAGE_KEY)
}

export function saveClientId(clientId: string): void {
  localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId)
}

export function clearClientId(): void {
  localStorage.removeItem(CLIENT_ID_STORAGE_KEY)
}

export function loadClientSecret(): string | null {
  return localStorage.getItem(CLIENT_SECRET_STORAGE_KEY)
}

export function saveClientSecret(secret: string): void {
  localStorage.setItem(CLIENT_SECRET_STORAGE_KEY, secret.trim())
}

export function clearClientSecret(): void {
  localStorage.removeItem(CLIENT_SECRET_STORAGE_KEY)
}

export function loadCodeVerifier(): string | null {
  return sessionStorage.getItem(PKCE_VERIFIER_STORAGE_KEY)
}

export function saveCodeVerifier(verifier: string): void {
  sessionStorage.setItem(PKCE_VERIFIER_STORAGE_KEY, verifier)
}

export function clearCodeVerifier(): void {
  sessionStorage.removeItem(PKCE_VERIFIER_STORAGE_KEY)
}
