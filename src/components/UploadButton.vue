<script setup lang="ts">
import { ref } from 'vue'

import { uploadFile } from '../lib/dav'

const emit = defineEmits<{ uploaded: [id: string] }>()

const input = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const error = ref<string | null>(null)

function pickFile(): void {
  input.value?.click()
}

async function onFileSelected(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) {
    return
  }
  if (!/\.pdf$/i.test(file.name)) {
    error.value = 'Only PDF files are supported.'
    return
  }

  uploading.value = true
  error.value = null
  try {
    await uploadFile(file.name, file)
    emit('uploaded', file.name)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="upload-button">
    <button type="button" :disabled="uploading" @click="pickFile">
      {{ uploading ? 'Uploading…' : 'Upload PDF' }}
    </button>
    <input
      ref="input"
      class="upload-button__input"
      type="file"
      accept="application/pdf,.pdf"
      @change="onFileSelected"
    />
    <p v-if="error" class="upload-button__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.upload-button {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}

.upload-button__input {
  display: none;
}

.upload-button__error {
  margin: 0;
  font-size: 0.75rem;
  color: #b3261e;
}
</style>
