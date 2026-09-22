/**
 * Reader store: owns the currently open PDF and its page position.
 *
 * Opening a book prefers the IndexedDB cache and falls back to a WebDAV
 * download (which is then cached for offline reading). The restored page comes
 * from the progress sidecar; page turns are persisted through `progress.ts`
 * (debounced PUT) or, while offline, appended to the offline replay queue.
 */

import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { downloadFile } from '../lib/dav'
import { extractMetadata, loadDocument } from '../lib/pdf'
import type { PdfMetadata } from '../lib/pdf'
import {
  cachePdf,
  flushQueue,
  getCachedPdf,
  isOnline,
  queueProgress,
} from '../lib/offline'
import { getDeviceId, loadProgress, saveProgress } from '../lib/progress'

interface ReaderState {
  bookId: string | null
  doc: PDFDocumentProxy | null
  metadata: PdfMetadata | null
  currentPage: number
  totalPages: number
  loading: boolean
  error: string | null
  /** True when the current document was served from the IndexedDB cache. */
  fromCache: boolean
}

function clampPage(page: number, totalPages: number): number {
  const max = totalPages > 0 ? totalPages : page
  return Math.min(Math.max(page, 1), max)
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useReaderStore = defineStore('reader', {
  state: (): ReaderState => ({
    bookId: null,
    doc: null,
    metadata: null,
    currentPage: 1,
    totalPages: 0,
    loading: false,
    error: null,
    fromCache: false,
  }),

  getters: {
    isOpen: (state): boolean => state.doc !== null,
  },

  actions: {
    /**
     * Load a book by its library-relative PDF path.
     * Tries the IDB cache first, downloads and caches on a miss, then restores
     * the last-read page from the progress sidecar.
     */
    async open(bookId: string): Promise<void> {
      this.bookId = bookId
      this.loading = true
      this.error = null
      this.doc = null
      this.metadata = null
      this.currentPage = 1
      this.totalPages = 0
      this.fromCache = false

      // Replay any progress writes queued while offline.
      void flushQueue()

      try {
        let data = await getCachedPdf(bookId)
        if (data) {
          this.fromCache = true
        } else {
          data = await downloadFile(bookId)
          // Cache before pdf.js consumes the buffer (it transfers to the worker).
          await cachePdf(bookId, data).catch((error: unknown) => {
            console.warn('[reader] failed to cache PDF', bookId, error)
          })
        }

        const doc = await loadDocument(data)
        this.doc = markRaw(doc)
        this.totalPages = doc.numPages

        const progress = await loadProgress(bookId).catch(() => null)
        this.currentPage = clampPage(progress?.lastPage ?? 1, doc.numPages)

        this.metadata = await extractMetadata(doc).catch((): PdfMetadata => ({
          title: undefined,
          author: undefined,
        }))
      } catch (error) {
        this.error = toMessage(error)
      } finally {
        this.loading = false
      }
    },

    /** Record a page turn: update state, then persist (or queue while offline). */
    setPage(page: number): void {
      const next = clampPage(page, this.totalPages)
      this.currentPage = next

      const bookId = this.bookId
      if (!bookId) {
        return
      }

      if (isOnline()) {
        saveProgress(bookId, next, this.totalPages)
      } else {
        queueProgress({
          bookId,
          lastPage: next,
          totalPages: this.totalPages,
          updatedAt: new Date().toISOString(),
          deviceId: getDeviceId(),
        })
      }
    },

    /** Close the current book and drop the document reference. */
    reset(): void {
      this.bookId = null
      this.doc = null
      this.metadata = null
      this.currentPage = 1
      this.totalPages = 0
      this.loading = false
      this.error = null
      this.fromCache = false
    },
  },
})
