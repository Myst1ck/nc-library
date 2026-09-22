import { defineStore } from 'pinia'

import {
  buildAuthorizeUrl,
  clearClientId,
  clearClientSecret,
  clearCodeVerifier,
  clearOAuthState,
  clearServer,
  clearTokens,
  exchangeCode,
  generateCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
  loadClientId,
  loadCodeVerifier,
  loadOAuthState,
  loadTokens,
  normalizeServer,
  saveClientId,
  saveClientSecret,
  saveCodeVerifier,
  saveOAuthState,
  saveServer,
  saveTokens,
} from '../lib/oauth'
import type { NcTokens } from '../lib/oauth'
import {
  clearCurrentUser,
  getCurrentServer,
  getCurrentUser,
  ocsFetch,
  setCurrentUser,
} from '../lib/nextcloud'

export type AuthStatus = 'idle' | 'authorizing' | 'authenticated' | 'error'

interface OcsUserResponse {
  ocs?: {
    data?: {
      id?: string
    }
  }
}

function currentRedirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    server: getCurrentServer() as string | null,
    user: getCurrentUser() as string | null,
    tokens: loadTokens() as NcTokens | null,
    status: 'idle' as AuthStatus,
  }),

  getters: {
    isAuthenticated: (state): boolean => Boolean(state.tokens?.accessToken),
  },

  actions: {
    /** Persist config, then send the browser to the Nextcloud authorize page. */
    async login(server: string, clientId: string, clientSecret: string): Promise<string> {
      const normalized = normalizeServer(server)
      saveServer(normalized)
      saveClientId(clientId)
      saveClientSecret(clientSecret)
      this.server = normalized
      this.status = 'authorizing'

      const verifier = generateCodeVerifier()
      saveCodeVerifier(verifier)
      const state = generateOAuthState()
      saveOAuthState(state)
      const challenge = await generateCodeChallenge(verifier)
      const url = buildAuthorizeUrl(
        normalized,
        clientId,
        currentRedirectUri(),
        challenge,
        state,
      )

      window.location.assign(url)
      return url
    },

    /**
     * Handle the OAuth redirect: exchange `?code=` for tokens, resolve the
     * user, clean the URL. Returns false when there is no code to handle.
     */
    async handleRedirect(): Promise<boolean> {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (!code) {
        return false
      }

      const server = getCurrentServer()
      const clientId = loadClientId()
      const verifier = loadCodeVerifier()
      const returnedState = params.get('state')
      const expectedState = loadOAuthState()
      if (!server || !clientId || !verifier) {
        this.status = 'error'
        throw new Error('OAuth redirect missing server, client id, or PKCE verifier')
      }
      if (!expectedState || !returnedState || returnedState !== expectedState) {
        clearCodeVerifier()
        clearOAuthState()
        this.status = 'error'
        throw new Error(
          'Sign-in session expired or was restarted on Nextcloud — click Login to start over',
        )
      }

      try {
        const tokens = await exchangeCode(server, clientId, code, verifier, currentRedirectUri())
        saveTokens(tokens)
        this.server = server
        this.tokens = tokens

        const user = await this.fetchCurrentUser(server)
        this.user = user
        setCurrentUser(user)

        clearCodeVerifier()
        clearOAuthState()
        window.history.replaceState({}, document.title, window.location.pathname)
        this.status = 'authenticated'
        return true
      } catch (error) {
        clearCodeVerifier()
        clearOAuthState()
        this.status = 'error'
        throw error
      }
    },

    /**
     * Resolve the current user id via the OCS cloud/user endpoint.
     *
     * Retries once on failure. When both attempts fail it throws, so login
     * fails loudly instead of completing with a null user (which would make
     * every WebDAV call throw later). Tokens are already persisted by the
     * caller, so the user can retry without redoing the OAuth dance.
     */
    async fetchCurrentUser(server: string): Promise<string | null> {
      const url = `${normalizeServer(server)}/ocs/v2.php/cloud/user?format=json`
      let lastError: unknown = null

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await ocsFetch(url)
          if (!response.ok) {
            lastError = new Error(`Nextcloud user lookup failed (${response.status})`)
            continue
          }
          const payload = (await response.json()) as OcsUserResponse
          const id = payload.ocs?.data?.id ?? null
          if (id) {
            return id
          }
          lastError = new Error('Nextcloud did not return a user id')
        } catch (error) {
          lastError = error
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error('Nextcloud user lookup failed')
    },

    /** Clear all persisted credentials and reset state. */
    logout(): void {
      clearTokens()
      clearServer()
      clearClientId()
      clearClientSecret()
      clearCodeVerifier()
      clearCurrentUser()
      this.server = null
      this.user = null
      this.tokens = null
      this.status = 'idle'
    },
  },
})
