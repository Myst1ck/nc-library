/**
 * Authenticated fetch wrappers for Nextcloud.
 *
 * Contract consumed by later subtasks:
 *   ncFetch(url, init)  -> fetch with `Authorization: Bearer <accessToken>`;
 *                          on 401 refreshes the token once and retries, then throws.
 *   ocsFetch(url, init) -> ncFetch plus the `OCS-APIRequest: true` header,
 *                          for the OCS Share API.
 */

import { loadClientId, loadServer, loadTokens, refresh, saveTokens } from './oauth'
import type { NcTokens } from './oauth'

export const USER_STORAGE_KEY = 'nc-book-pwa.user'

/** Currently configured Nextcloud base URL, or null. */
export function getCurrentServer(): string | null {
  return loadServer()
}

/** Currently authenticated Nextcloud user id, or null. */
export function getCurrentUser(): string | null {
  return localStorage.getItem(USER_STORAGE_KEY)
}

export function setCurrentUser(user: string | null): void {
  if (user) {
    localStorage.setItem(USER_STORAGE_KEY, user)
  } else {
    localStorage.removeItem(USER_STORAGE_KEY)
  }
}

export function clearCurrentUser(): void {
  localStorage.removeItem(USER_STORAGE_KEY)
}

function withAuthHeaders(init: RequestInit | undefined, accessToken: string | null): Headers {
  const headers = new Headers(init?.headers)
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }
  return headers
}

let refreshInFlight: Promise<boolean> | null = null

/** Refresh the stored access token. Concurrent callers share one attempt. */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight
  }

  refreshInFlight = (async (): Promise<boolean> => {
    const tokens = loadTokens()
    const server = loadServer()
    const clientId = loadClientId()
    if (!tokens?.refreshToken || !server || !clientId) {
      return false
    }
    try {
      const next: NcTokens = await refresh(server, clientId, tokens.refreshToken)
      saveTokens(next)
      return true
    } catch {
      return false
    }
  })()

  try {
    return await refreshInFlight
  } finally {
    refreshInFlight = null
  }
}

function authorizedFetch(url: string, init?: RequestInit): Promise<Response> {
  const tokens = loadTokens()
  return fetch(url, {
    ...init,
    headers: withAuthHeaders(init, tokens?.accessToken ?? null),
  })
}

/**
 * Fetch a Nextcloud resource with a bearer token.
 *
 * On 401: refresh once, retry once, then throw. Throws earlier if no refresh
 * token/server/client id is available to perform the refresh.
 */
export async function ncFetch(url: string, init?: RequestInit): Promise<Response> {
  let response = await authorizedFetch(url, init)
  if (response.status !== 401) {
    return response
  }

  const refreshed = await refreshAccessToken()
  if (!refreshed) {
    throw new Error('Nextcloud request unauthorized (401) and token refresh unavailable')
  }

  response = await authorizedFetch(url, init)
  if (response.status === 401) {
    throw new Error('Nextcloud request unauthorized (401) after token refresh')
  }
  return response
}

/** ncFetch with the OCS-APIRequest header required by the OCS APIs. */
export function ocsFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('OCS-APIRequest', 'true')
  return ncFetch(url, { ...init, headers })
}
