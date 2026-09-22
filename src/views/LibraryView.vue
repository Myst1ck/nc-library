<script setup lang="ts">
import { onMounted } from 'vue'

import BookCard from '../components/BookCard.vue'
import UploadButton from '../components/UploadButton.vue'
import { useLibraryStore } from '../stores/library'

const library = useLibraryStore()

function handleUploaded(): void {
  void library.scan()
}

onMounted(() => {
  void library.scan()
})
</script>

<template>
  <main class="library">
    <header class="library__header">
      <h1 class="library__title">Library</h1>
      <UploadButton @uploaded="handleUploaded" />
    </header>

    <p v-if="library.loading" class="library__status">Loading library…</p>

    <p v-else-if="library.error" class="library__status library__status--error">
      {{ library.error }}
    </p>

    <p v-else-if="library.books.length === 0" class="library__status">
      No PDFs in your Books folder yet. Upload one to get started.
    </p>

    <ul v-else class="library__grid">
      <li v-for="book in library.books" :key="book.id" class="library__grid-item">
        <BookCard :book="book" />
      </li>
    </ul>
  </main>
</template>

<style scoped>
.library {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}

.library__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.library__title {
  margin: 0;
  font-size: 1.5rem;
}

.library__status {
  color: #57606a;
}

.library__status--error {
  color: #b3261e;
}

.library__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
