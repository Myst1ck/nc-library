/**
 * Reading-progress sidecar helpers.
 *
 * One JSON sidecar per book lives next to the PDF on WebDAV:
 * `<bookPath without .pdf>.progress.json`, written through `dav.writeSidecar`.
 * Schema is shared with the library view:
 *   { lastPage, totalPages, updatedAt (ISO), deviceId }
 *
 * Conflict resolution is last-write-wins on `updatedAt` (see `mergeProgress`).
 * Writes are debounced so rapid page turns collapse into one PUT.
 */

import { readSidecar, writeSidecar } from './dav'
import { queueProgress } from './offline'

export interface ProgressSidecar {
  lastPage: number
  totalPages: number
  updatedAt: string
  deviceId: string
}

const DEVICE_ID_STORAGE_KEY = 'nc-book-pwa.deviceId'

/** Trailing debounce for `saveProgress`. */
export const SAVE_DEBOUNCE_MS = 2000

/** Persistent per-browser id used to attribute progress writes. */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY)
  if (!id) {
    id = randomDeviceId()
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, id)
  }
  return id
}

function randomDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Validate an untrusted sidecar payload; returns `null` when malformed. */
export function parseProgress(raw: unknown): ProgressSidecar | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const record = raw as Record<string, unknown>
  if (!isFiniteNumber(record.lastPage) || !isFiniteNumber(record.totalPages)) {
    return null
  }
  if (typeof record.updatedAt !== 'string') {
    return null
  }
  return {
    lastPage: record.lastPage,
    totalPages: record.totalPages,
    updatedAt: record.updatedAt,
    deviceId: typeof record.deviceId === 'string' ? record.deviceId : getDeviceId(),
  }
}

/** Last-write-wins merge on `updatedAt`; ISO-8601 strings compare lexically. */
export function mergeProgress(
  a: ProgressSidecar | null,
  b: ProgressSidecar | null,
): ProgressSidecar | null {
  if (!a) return b
  if (!b) return a
  return a.updatedAt >= b.updatedAt ? a : b
}

/** Read and validate a book's sidecar; `null` when missing or malformed. */
export async function loadProgress(bookId: string): Promise<ProgressSidecar | null> {
  const raw = await readSidecar(bookId)
  return parseProgress(raw)
}

const pendingWrites = new Map<string, ProgressSidecar>()
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Queue a progress write, flushed `SAVE_DEBOUNCE_MS` after the last call. */
export function saveProgress(bookId: string, lastPage: number, totalPages: number): void {
  pendingWrites.set(bookId, {
    lastPage,
    totalPages,
    updatedAt: new Date().toISOString(),
    deviceId: getDeviceId(),
  })

  const existing = writeTimers.get(bookId)
  if (existing) {
    clearTimeout(existing)
  }
  writeTimers.set(
    bookId,
    setTimeout(() => {
      void flushProgress(bookId)
    }, SAVE_DEBOUNCE_MS),
  )
}

/**
 * Immediately write any pending progress for `bookId`.
 * Never rejects: a failed PUT is logged, not thrown.
 *
 * The pending entry is only dropped once the PUT succeeds. On failure it is
 * re-queued through the offline replay queue (`offline.queueProgress`) so the
 * next flush trigger (reconnect / reader startup) retries it. The entry is not
 * kept in `pendingWrites`, so a failure never triggers an immediate retry loop.
 */
export async function flushProgress(bookId: string): Promise<void> {
  const timer = writeTimers.get(bookId)
  if (timer) {
    clearTimeout(timer)
    writeTimers.delete(bookId)
  }

  const entry = pendingWrites.get(bookId)
  if (!entry) {
    return
  }

  try {
    await writeSidecar(bookId, entry)
    if (pendingWrites.get(bookId) === entry) {
      pendingWrites.delete(bookId)
    }
  } catch (error) {
    console.warn('[progress] failed to write sidecar', bookId, error)
    if (pendingWrites.get(bookId) === entry) {
      pendingWrites.delete(bookId)
    }
    queueProgress({ ...entry, bookId })
  }
}

/** Flush every pending debounced write immediately. */
export function flushPendingProgress(): void {
  for (const bookId of Array.from(pendingWrites.keys())) {
    void flushProgress(bookId)
  }
}

// Backgrounding or closing the tab must not drop a debounced write, so flush
// any pending progress when the page is hidden or unloaded.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    flushPendingProgress()
  })
  window.document.addEventListener('visibilitychange', () => {
    if (window.document.visibilityState === 'hidden') {
      flushPendingProgress()
    }
  })
}
