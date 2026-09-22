<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { renderPage, type RenderTask } from '../lib/pdf'

const props = withDefaults(
  defineProps<{
    doc: PDFDocumentProxy
    initialPage?: number
  }>(),
  { initialPage: 1 }
)

const emit = defineEmits<{
  (e: 'page-change', page: number): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const currentPage = ref(props.initialPage)
const pageCount = ref(props.doc.numPages)
const rendering = ref(false)

let activeTask: RenderTask | null = null
let renderToken = 0

function cancelActive(): void {
  if (activeTask) {
    activeTask.cancel()
    activeTask = null
  }
}

function isCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'RenderingCancelledException'
  )
}

async function draw(pageNum: number): Promise<void> {
  const canvas = canvasRef.value
  if (!canvas) {
    return
  }

  const token = ++renderToken
  cancelActive()
  rendering.value = true

  try {
    const task = await renderPage(props.doc, pageNum, canvas)
    if (token !== renderToken) {
      // Superseded by a newer render or unmounted: abort this one.
      task.cancel()
      return
    }
    activeTask = task
    await task.promise
    currentPage.value = pageNum
    emit('page-change', pageNum)
  } catch (error) {
    if (!isCancelled(error)) {
      console.error('[PdfViewer] failed to render page', pageNum, error)
    }
  } finally {
    if (token === renderToken) {
      activeTask = null
      rendering.value = false
    }
  }
}

function goTo(pageNum: number): void {
  const clamped = Math.min(Math.max(pageNum, 1), pageCount.value)
  void draw(clamped)
}

function next(): void {
  goTo(currentPage.value + 1)
}

function prev(): void {
  goTo(currentPage.value - 1)
}

onMounted(() => {
  void draw(currentPage.value)
})

watch(
  () => props.doc,
  (doc) => {
    pageCount.value = doc.numPages
    goTo(1)
  }
)

onBeforeUnmount(() => {
  renderToken++
  cancelActive()
})
</script>

<template>
  <div class="pdf-viewer">
    <div class="pdf-viewer__toolbar">
      <button
        type="button"
        class="pdf-viewer__button"
        :disabled="currentPage <= 1"
        @click="prev"
      >
        Prev
      </button>
      <span class="pdf-viewer__indicator" aria-live="polite">
        {{ currentPage }} / {{ pageCount }}
      </span>
      <button
        type="button"
        class="pdf-viewer__button"
        :disabled="currentPage >= pageCount"
        @click="next"
      >
        Next
      </button>
    </div>
    <div class="pdf-viewer__stage">
      <canvas
        ref="canvasRef"
        class="pdf-viewer__canvas"
        :aria-busy="rendering"
      ></canvas>
    </div>
  </div>
</template>

<style scoped>
.pdf-viewer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 100%;
}

.pdf-viewer__toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.pdf-viewer__indicator {
  min-width: 6ch;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pdf-viewer__stage {
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
}

.pdf-viewer__canvas {
  max-width: 100%;
  height: auto;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25);
}
</style>
