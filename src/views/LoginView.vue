<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth'

const REDIRECT_STORAGE_KEY = 'nc-book-pwa.redirect'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const server = ref(auth.server ?? '')
const clientId = ref('')
const clientSecret = ref('')
const error = ref('')
const busy = ref(false)

function queryValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

onMounted(async () => {
  const redirect = queryValue(route.query.redirect)
  if (redirect) {
    sessionStorage.setItem(REDIRECT_STORAGE_KEY, redirect)
  }

  const code = queryValue(route.query.code)
  if (!code) {
    return
  }

  busy.value = true
  try {
    const handled = await auth.handleRedirect()
    if (handled) {
      const target = sessionStorage.getItem(REDIRECT_STORAGE_KEY) ?? '/'
      sessionStorage.removeItem(REDIRECT_STORAGE_KEY)
      await router.replace(target)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Sign-in failed'
  } finally {
    busy.value = false
  }
})

async function handleSubmit(): Promise<void> {
  if (busy.value) {
    return
  }

  error.value = ''

  if (!server.value.trim()) {
    error.value = 'Enter your Nextcloud server URL.'
    return
  }
  if (!clientId.value.trim()) {
    error.value = 'Enter the OAuth2 client ID.'
    return
  }
  if (!clientSecret.value.trim()) {
    error.value = 'Enter the OAuth2 client secret.'
    return
  }

  const redirect = queryValue(route.query.redirect)
  if (redirect) {
    sessionStorage.setItem(REDIRECT_STORAGE_KEY, redirect)
  }

  busy.value = true
  try {
    await auth.login(server.value, clientId.value, clientSecret.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not start sign-in'
    busy.value = false
  }
}
</script>

<template>
  <main class="login">
    <h1 class="login__title">Sign in to Nextcloud</h1>

    <p v-if="busy" class="login__status">Signing in…</p>

    <form v-else class="login__form" @submit.prevent="handleSubmit">
      <label class="login__field">
        <span class="login__label">Server URL</span>
        <input
          v-model="server"
          class="login__input"
          type="url"
          inputmode="url"
          autocomplete="url"
          placeholder="https://cloud.example.com"
          required
        />
      </label>

      <label class="login__field">
        <span class="login__label">OAuth2 client ID</span>
        <input
          v-model="clientId"
          class="login__input"
          type="text"
          autocomplete="off"
          placeholder="Client ID from your Nextcloud OAuth2 app"
          required
        />
      </label>

      <label class="login__field">
        <span class="login__label">OAuth2 client secret</span>
        <input
          v-model="clientSecret"
          class="login__input"
          type="password"
          autocomplete="off"
          placeholder="Client secret from your Nextcloud OAuth2 app"
          required
        />
      </label>

      <p v-if="error" class="login__error">{{ error }}</p>

      <button class="login__submit" type="submit" :disabled="busy">Login</button>
    </form>

    <p class="login__hint">
      Register an OAuth2 app in Nextcloud under
      <strong>Settings → Security → OAuth 2.0</strong>, then copy both the client
      ID and the client secret from that app into the fields above. The redirect
      URI must be this app's origin.
    </p>
  </main>
</template>

<style scoped>
.login {
  max-width: 28rem;
  margin: 0 auto;
  padding: 3rem 1rem;
}

.login__title {
  margin: 0 0 1.5rem;
  font-size: 1.5rem;
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.login__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.login__label {
  font-size: 0.875rem;
  font-weight: 600;
}

.login__input {
  padding: 0.5rem 0.65rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font: inherit;
}

.login__input:focus {
  outline: 2px solid #0082c9;
  outline-offset: 1px;
}

.login__submit {
  padding: 0.6rem 1rem;
  border: none;
  border-radius: 6px;
  background: #0082c9;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.login__submit:hover {
  background: #006aa3;
}

.login__submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login__status {
  color: #57606a;
}

.login__error {
  margin: 0;
  color: #b3261e;
}

.login__hint {
  margin-top: 1.5rem;
  color: #57606a;
  font-size: 0.875rem;
  line-height: 1.5;
}
</style>