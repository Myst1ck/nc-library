<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth'

const FOLDER_STORAGE_KEY = 'nc-book-pwa.folder'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const auth = useAuthStore()
const router = useRouter()

const folder = ref(localStorage.getItem(FOLDER_STORAGE_KEY) ?? '')
const saved = ref(false)
const installEvent = ref<BeforeInstallPromptEvent | null>(null)

function saveFolder(): void {
  const value = folder.value.trim()
  if (value) {
    localStorage.setItem(FOLDER_STORAGE_KEY, value)
  } else {
    localStorage.removeItem(FOLDER_STORAGE_KEY)
  }
  saved.value = true
}

function handleLogout(): void {
  auth.logout()
  void router.push('/login')
}

function handleBeforeInstall(event: Event): void {
  event.preventDefault()
  installEvent.value = event as BeforeInstallPromptEvent
}

async function handleInstall(): Promise<void> {
  const event = installEvent.value
  if (!event) {
    return
  }
  await event.prompt()
  await event.userChoice
  installEvent.value = null
}

onMounted(() => {
  window.addEventListener('beforeinstallprompt', handleBeforeInstall)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
})
</script>

<template>
  <main class="settings">
    <h1 class="settings__title">Settings</h1>

    <section class="settings__section">
      <h2 class="settings__heading">Account</h2>
      <dl class="settings__list">
        <dt class="settings__term">Server</dt>
        <dd class="settings__value">{{ auth.server ?? 'Not configured' }}</dd>
        <dt class="settings__term">User</dt>
        <dd class="settings__value">{{ auth.user ?? 'Unknown' }}</dd>
      </dl>
    </section>

    <section class="settings__section">
      <h2 class="settings__heading">Library folder</h2>
      <label class="settings__field">
        <span class="settings__label">Folder path</span>
        <input
          v-model="folder"
          class="settings__input"
          type="text"
          placeholder="Books"
          @input="saved = false"
        />
      </label>
      <p class="settings__note">
        Leave empty to use the default <code>Books</code> folder. The override is
        applied after reload.
      </p>
      <button class="settings__button" type="button" @click="saveFolder">
        Save folder
      </button>
      <p v-if="saved" class="settings__saved">Saved. Reload to apply.</p>
    </section>

    <section class="settings__section">
      <h2 class="settings__heading">App</h2>
      <button
        v-if="installEvent"
        class="settings__button"
        type="button"
        @click="handleInstall"
      >
        Install app
      </button>
      <button class="settings__button settings__button--danger" type="button" @click="handleLogout">
        Log out
      </button>
    </section>
  </main>
</template>

<style scoped>
.settings {
  max-width: 36rem;
  margin: 0 auto;
  padding: 2rem 1rem 3rem;
}

.settings__title {
  margin: 0 0 1.5rem;
  font-size: 1.5rem;
}

.settings__section {
  margin-bottom: 2rem;
}

.settings__heading {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}

.settings__list {
  display: grid;
  grid-template-columns: 6rem 1fr;
  gap: 0.35rem 1rem;
  margin: 0;
}

.settings__term {
  color: #57606a;
}

.settings__value {
  margin: 0;
  overflow-wrap: anywhere;
}

.settings__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.settings__label {
  font-size: 0.875rem;
  font-weight: 600;
}

.settings__input {
  padding: 0.5rem 0.65rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font: inherit;
}

.settings__input:focus {
  outline: 2px solid #0082c9;
  outline-offset: 1px;
}

.settings__note {
  margin: 0.5rem 0 0.75rem;
  color: #57606a;
  font-size: 0.875rem;
}

.settings__button {
  padding: 0.5rem 0.9rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #f6f8fa;
  font: inherit;
  cursor: pointer;
}

.settings__button:hover {
  background: #eaeef2;
}

.settings__button--danger {
  margin-left: 0.5rem;
  border-color: #b3261e;
  color: #b3261e;
}

.settings__saved {
  margin: 0.5rem 0 0;
  color: #1a7f37;
  font-size: 0.875rem;
}
</style>