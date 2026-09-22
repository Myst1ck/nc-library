<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import PdfViewer from '../components/PdfViewer.vue'
import { useReaderStore } from '../stores/reader'
import { flushProgress } from '../lib/progress'

const props = defineProps<{ id: string }>()

const router = useRouter()
const store = useReaderStore()
const { doc, metadata, currentPage, loading, error, fromCache } =
  storeToRefs(store)

const fileName = computed(() => props.id.split('/').pop() ?? props.id)

const title = computed(() => metadata.value?.title?.trim() || fileName.value)

const author = computed(() => metadata.value?.author?.trim() || null)

function goBack(): void {
  // Always return to the library route: history.back() can land on the
  // Nextcloud authorize page after the OAuth round-trip.
  void router.push({ name: 'library' })
}

function onPageChange(page: number): void {
  store.setPage(page)
}

onMounted(() => {
  void store.open(props.id)
})

watch(
  () => props.id,
  (id) => {
    void store.open(id)
  },
)

onBeforeUnmount(() => {
  const bookId = store.bookId
  if (bookId) {
    void flushProgress(bookId)
  }
  store.reset()
})
</script>

<template>
  <main class="reader">
    <header class="reader__bar">
      <button type="button" class="reader__back" @click="goBack">Back</button>
      <div class="reader__heading">
        <h1 class="reader__title">{{ title }}</h1>
        <p v-if="author" class="reader__author">{{ author }}</p>
      </div>
      <span v-if="fromCache" class="reader__badge" title="Served from offline cache">
        Offline
      </span>
    </header>

    <p v-if="loading" class="reader__status">Loading…</p>

    <p v-else-if="error" class="reader__status reader__status--error" role="alert">
      {{ error }}
    </p>

    <PdfViewer
      v-else-if="doc"
      :doc="doc"
      :initial-page="currentPage"
      @page-change="onPageChange"
    />
  </main>
</template>

<style scoped>
.reader {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  height: 100%;
  padding: 1rem;
  box-sizing: border-box;
}

.reader__bar {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.reader__heading {
  flex: 1;
  min-width: 0;
}

.reader__title {
  margin: 0;
  font-size: 1.1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reader__author {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.7;
}

.reader__badge {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  opacity: 0.7;
}

.reader__status {
  margin: 0;
  padding: 1rem 0;
}

.reader__status--error {
  color: #b3261e;
}
</style>
