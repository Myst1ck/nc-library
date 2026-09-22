/**
 * Offline support: IndexedDB PDF cache + a progress-write replay queue.
 *
 * IndexedDB database `nc-book-pwa` holds:
 *   - `covers`  (owned by the library view: book id -> cover data URL)
 *   - `pdfs`    (owned here: book id -> raw PDF bytes, ArrayBuffer)
 *
 * The database is opened without an explicit version so we never trigger a
 * downgrade if another module opened it at a higher version. When the database
 * does not exist yet our `upgrade` callback creates BOTH stores, which keeps
 * the two owners idempotent regardless of load order.
 *
 * Progress writes made while offline are appended to a localStorage queue and
 * replayed on the window `online` event and at reader startup. Replay merges
 * against the server sidecar and drops entries the server already superseded.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import { readSidecar, writeSidecar } from './dav'
import { mergeProgress, parseProgress } from './progress'
import type { ProgressSidecar } from './progress'

const DB_NAME = 'nc-book-pwa'
const COVERS_STORE = 'covers'
const PDFS_STORE = 'pdfs'
const QUEUE_STORAGE_KEY = 'nc-book-pwa.progressQueue'

interface NcBookDb extends DBSchema {
  covers: { key: string; value: unknown }
  pdfs: { key: string; value: ArrayBuffer }
}

/** A queued progress write: sidecar payload plus the book it belongs to. */
export interface QueuedProgress extends ProgressSidecar {
  bookId: string
}

let dbPromise: Promise<IDBPDatabase<NcBookDb>> | null = null

function getDb(): Promise<IDBPDatabase<NcBookDb>> {
  if (!dbPromise) {
    dbPromise = openDB<NcBookDb>(DB_NAME, undefined, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(COVERS_STORE)) {
          db.createObjectStore(COVERS_STORE)
        }
        if (!db.objectStoreNames.contains(PDFS_STORE)) {
          db.createObjectStore(PDFS_STORE)
        }
      },
    })
  }
  return dbPromise
}

/** Persist a book's PDF bytes for offline reading. */
export async function cachePdf(bookId: string, data: ArrayBuffer): Promise<void> {
  const db = await getDb()
  await db.put(PDFS_STORE, data, bookId)
}

/** Cached PDF bytes for a book, or `null` when not cached. */
export async function getCachedPdf(bookId: string): Promise<ArrayBuffer | null> {
  const db = await getDb()
  const value = await db.get(PDFS_STORE, bookId)
  return value instanceof ArrayBuffer ? value : null
}

/** Drop a cached PDF (e.g. after eviction). */
export async function removeCachedPdf(bookId: string): Promise<void> {
  const db = await getDb()
  await db.delete(PDFS_STORE, bookId)
}

/** Whether the browser currently reports a network connection. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function readQueue(): QueuedProgress[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      const record = item as Record<string, unknown>
      const sidecar = parseProgress(record)
      return sidecar && typeof record.bookId === 'string'
        ? [{ ...sidecar, bookId: record.bookId }]
        : []
    })
  } catch {
    return []
  }
}

function writeQueue(items: QueuedProgress[]): void {
  try {
    if (items.length === 0) {
      localStorage.removeItem(QUEUE_STORAGE_KEY)
    } else {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items))
    }
  } catch (error) {
    console.warn('[offline] failed to persist progress queue', error)
  }
}

/** Queue (or refresh) a progress write to replay once back online. */
export function queueProgress(entry: QueuedProgress): void {
  const queue = readQueue().filter((item) => item.bookId !== entry.bookId)
  queue.push(entry)
  writeQueue(queue)
}

/**
 * Replay queued progress writes.
 *
 * Per entry: read the server sidecar, keep whichever side is newer, and PUT
 * ours only when it wins. Entries that still fail stay queued for next time.
 */
export async function flushQueue(): Promise<void> {
  const queue = readQueue()
  if (queue.length === 0) {
    return
  }

  const remaining: QueuedProgress[] = []
  for (const entry of queue) {
    try {
      const server = parseProgress(await readSidecar(entry.bookId))
      const winner = mergeProgress(entry, server)
      if (winner === entry) {
        await writeSidecar(entry.bookId, entry)
      }
      // Server already newer: drop the local entry.
    } catch {
      remaining.push(entry)
    }
  }

  writeQueue(remaining)
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flushQueue()
  })
}
