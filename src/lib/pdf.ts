import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

/** pdf.js render task handle; await `.promise` for completion, call `.cancel()` to abort. */
export type RenderTask = ReturnType<PDFPageProxy['render']>

export interface PdfMetadata {
  title: string | undefined
  author: string | undefined
}

/**
 * Load a PDF from raw bytes (downloaded from WebDAV, from cache, etc.).
 * Resolves with the parsed document proxy.
 */
export async function loadDocument(
  data: ArrayBuffer | Uint8Array
): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjsLib.getDocument({ data })
  return loadingTask.promise
}

/**
 * Render `pageNum` of `doc` into `canvas` at devicePixelRatio-scaled resolution.
 * Returns the pdf.js render task so callers can cancel in-flight renders.
 */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNum: number,
  canvas: HTMLCanvasElement
): Promise<RenderTask> {
  const page = await doc.getPage(pageNum)
  const outputScale = window.devicePixelRatio || 1
  const viewport = page.getViewport({ scale: 1 })

  canvas.width = Math.floor(viewport.width * outputScale)
  canvas.height = Math.floor(viewport.height * outputScale)
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to acquire 2D canvas context')
  }

  const transform =
    outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined

  return page.render({ canvasContext: context, viewport, transform })
}

/**
 * Extract `{ title, author }` from the document's metadata info dictionary.
 * Missing entries resolve to `undefined`.
 */
export async function extractMetadata(
  doc: PDFDocumentProxy
): Promise<PdfMetadata> {
  const { info } = await doc.getMetadata()
  const record = (info ?? {}) as Record<string, unknown>
  return {
    title: typeof record.Title === 'string' ? record.Title : undefined,
    author: typeof record.Author === 'string' ? record.Author : undefined
  }
}

/**
 * Render page 1 to an offscreen canvas and return a PNG data URL.
 * `maxWidth` bounds the rendered width in CSS pixels (default 320).
 */
export async function renderCover(
  doc: PDFDocumentProxy,
  maxWidth = 320
): Promise<string> {
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const scale = maxWidth > 0 ? maxWidth / base.width : 1
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to acquire 2D canvas context')
  }

  const task = page.render({ canvasContext: context, viewport })
  await task.promise

  return canvas.toDataURL('image/png')
}
