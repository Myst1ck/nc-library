/**
 * Library store: indexes the PDFs in the Nextcloud `Books` folder.
 *
 * Book identity is the PDF path relative to the Books folder (e.g.
 * `novels/dune.pdf`); the same string is the `/read/:id` router param.
 *
 * IndexedDB (db `nc-book-pwa`) is the only cache: `covers` holds page-1 PNG
 * data URLs keyed by book id, `pdfs` is reserved for the reader (subtask 06).
 * Both stores are created here so no later upgrade is needed.
 */

import { defineStore } from 'pinia'
import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

import { downloadFile, listFolder, readSidecar } from '../lib/dav'
import type { DavEntry } from '../lib/dav'
import { loadDocument, renderCover } from '../lib/pdf'

export const DB_NAME = 'nc-book-pwa'
export const DB_VERSION = 1
export const COVER_STORE = 'covers' as const
export const PDF_STORE = 'pdfs' as const

export interface LibraryProgress {
  lastPage: number
  totalPages: number
  updatedAt: string
}

export interface LibraryBook {
  id: string
  name: string
  size: number
  lastModified: string | null
  cover?: string
  progress?: LibraryProgress
}

export interface LibraryDbSchema extends DBSchema {
  covers: { key: string; value: string }
  pdfs: { key: string; value: ArrayBuffer }
}

/** How many covers to generate up front before falling back to the background. */
const COVER_EAGER_COUNT = 6

let dbPromise: Promise<IDBPDatabase<LibraryDbSchema>> | null = null

/** Open (and lazily create) the shared library database. */
export function openLibraryDb(): Promise<IDBPDatabase<LibraryDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<LibraryDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(COVER_STORE)) {
          db.createObjectStore(COVER_STORE)
        }
        if (!db.objectStoreNames.contains(PDF_STORE)) {
          db.createObjectStore(PDF_STORE)
        }
      },
    })
  }
  return dbPromise
}

function isPdf(entry: DavEntry): boolean {
  return !entry.isDirectory && /\.pdf$/i.test(entry.name)
}

function toFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Parse a sidecar payload, tolerating missing or malformed fields. */
function parseProgress(raw: Record<string, unknown> | null): LibraryProgress | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const lastPage = toFiniteNumber(raw.lastPage)
  const totalPages = toFiniteNumber(raw.totalPages)
  if (lastPage === undefined || totalPages === undefined) {
    return undefined
  }
  return {
    lastPage,
    totalPages,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  }
}

export const useLibraryStore = defineStore('library', {
  state: () => ({
    books: [] as LibraryBook[],
    loading: false,
    error: null as string | null,
  }),

  actions: {
    /** List the Books folder, then hydrate covers and progress. */
    async scan(): Promise<void> {
      this.loading = true
      this.error = null
      try {
        const entries = await listFolder('')
        const pdfs = entries.filter(isPdf)
        const db = await openLibraryDb()

        const books: LibraryBook[] = []
        for (const entry of pdfs) {
          const cached = await db.get(COVER_STORE, entry.path)
          books.push({
            id: entry.path,
            name: entry.name,
            size: entry.size,
            lastModified: entry.lastModified,
            cover: cached ?? undefined,
          })
        }
        this.books = books

        await this.loadProgress()
        // Covers are generated lazily so the grid renders without waiting on PDFs.
        void this.ensureCovers()
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    /** Re-read one book's metadata, cover and progress (post-upload/post-read). */
    async refreshBook(id: string): Promise<void> {
      try {
        const entries = await listFolder('')
        const entry = entries.find((candidate) => candidate.path === id && isPdf(candidate))
        if (!entry) {
          this.books = this.books.filter((book) => book.id !== id)
          return
        }

        const db = await openLibraryDb()
        const cached = await db.get(COVER_STORE, id)
        const progress = parseProgress(await readSidecar(id))

        const existing = this.books.find((book) => book.id === id)
        if (existing) {
          existing.name = entry.name
          existing.size = entry.size
          existing.lastModified = entry.lastModified
          existing.progress = progress
          if (cached) {
            existing.cover = cached
          }
        } else {
          const book: LibraryBook = {
            id,
            name: entry.name,
            size: entry.size,
            lastModified: entry.lastModified,
            cover: cached ?? undefined,
            progress,
          }
          this.books.push(book)
          if (!book.cover) {
            await this.generateCover(book)
          }
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      }
    },

    /** Read every book's progress sidecar; per-book failures are ignored. */
    async loadProgress(): Promise<void> {
      await Promise.all(
        this.books.map(async (book) => {
          try {
            const progress = parseProgress(await readSidecar(book.id))
            if (progress) {
              book.progress = progress
            }
          } catch {
            // A missing or unreadable sidecar simply means "no progress".
          }
        }),
      )
    },

    /** Generate the first batch of covers, then the rest in the background. */
    async ensureCovers(): Promise<void> {
      try {
        const missing = this.books.filter((book) => !book.cover)
        const eager = missing.slice(0, COVER_EAGER_COUNT)
        const deferred = missing.slice(COVER_EAGER_COUNT)

        for (const book of eager) {
          await this.generateCover(book)
        }

        if (deferred.length > 0) {
          void (async () => {
            for (const book of deferred) {
              await this.generateCover(book)
            }
          })()
        }
      } catch {
        // Cover generation is best-effort; the placeholder stays on failure.
      }
    },

    /** Download a PDF and cache its page-1 cover; no-op when already cached. */
    async generateCover(book: LibraryBook): Promise<void> {
      const db = await openLibraryDb()
      const cached = await db.get(COVER_STORE, book.id)
      if (cached) {
        book.cover = cached
        return
      }

      try {
        const data = await downloadFile(book.id)
        const doc = await loadDocument(data)
        try {
          const cover = await renderCover(doc)
          await db.put(COVER_STORE, cover, book.id)
          book.cover = cover
        } finally {
          await doc.destroy()
        }
      } catch {
        // Leave the placeholder in place; a later scan retries.
      }
    },
  },
})
