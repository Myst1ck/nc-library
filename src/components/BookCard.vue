<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import type { LibraryBook } from '../stores/library'

const props = defineProps<{ book: LibraryBook }>()

const router = useRouter()

const progressPercent = computed<number | null>(() => {
  const progress = props.book.progress
  if (!progress || progress.totalPages <= 0) {
    return null
  }
  const ratio = progress.lastPage / progress.totalPages
  return Math.min(100, Math.max(0, Math.round(ratio * 100)))
})

function openBook(): void {
  void router.push(`/read/${encodeURIComponent(props.book.id)}`)
}
</script>

<template>
  <article class="book-card" tabindex="0" role="button" @click="openBook" @keydown.enter="openBook">
    <div class="book-card__cover">
      <img v-if="book.cover" :src="book.cover" :alt="book.name" />
      <span v-else class="book-card__placeholder" aria-hidden="true">PDF</span>
    </div>

    <h2 class="book-card__title" :title="book.name">{{ book.name }}</h2>

    <div v-if="progressPercent !== null" class="book-card__progress" :aria-label="`Progress ${progressPercent}%`">
      <div class="book-card__progress-bar" :style="{ width: `${progressPercent}%` }" />
    </div>
    <p v-else class="book-card__unread">Not started</p>
  </article>
</template>

<style scoped>
.book-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border, #d0d7de);
  border-radius: 0.5rem;
  background: var(--color-surface, #fff);
  cursor: pointer;
}

.book-card:focus-visible {
  outline: 2px solid var(--color-accent, #0b6bcb);
  outline-offset: 2px;
}

.book-card__cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 0.375rem;
  background: #f0f2f5;
}

.book-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.book-card__placeholder {
  font-size: 1.25rem;
  font-weight: 600;
  color: #8a94a6;
}

.book-card__title {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-card__progress {
  height: 0.375rem;
  border-radius: 999px;
  background: #e4e7eb;
  overflow: hidden;
}

.book-card__progress-bar {
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent, #0b6bcb);
}

.book-card__unread {
  margin: 0;
  font-size: 0.75rem;
  color: #8a94a6;
}
</style>
