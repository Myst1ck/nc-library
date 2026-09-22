/**
 * WebDAV client for the Nextcloud book library.
 *
 * Everything is rooted at `/remote.php/dav/files/{user}/{folder}/` with
 * `folder` defaulting to `Books`. Paths passed to the helpers are relative to
 * that root (e.g. `novels/dune.pdf`). All requests go through `ncFetch`, so
 * bearer auth and the 401-refresh-retry behaviour are inherited.
 *
 * No `webdav` dependency: PROPFIND parsing is done directly with DOMParser so
 * we control namespace handling and the returned entry shape.
 */

import { ncFetch, getCurrentServer, getCurrentUser } from './nextcloud'
import { normalizeServer } from './oauth'

export const DEFAULT_FOLDER = 'Books'
export const FOLDER_STORAGE_KEY = 'nc-book-pwa.folder'
export const PROGRESS_SIDECAR_SUFFIX = '.progress.json'

/** One entry returned by `listFolder`. `path` is relative to the library root. */
export interface DavEntry {
  name: string
  path: string
  size: number
  lastModified: string | null
  isDirectory: boolean
}

/** Encode a relative path, segment by segment, preserving `/` separators. */
function encodeSegments(value: string): string {
  return value
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (segment === '.' || segment === '..') {
        throw new Error(`Invalid path segment "${segment}"`)
      }
      return encodeURIComponent(segment)
    })
    .join('/')
}

/** Strip leading/trailing slashes; fall back to `DEFAULT_FOLDER` when empty. */
function sanitizeFolder(value: string): string {
  const trimmed = value.replace(/^\/+|\/+$/g, '').trim()
  if (trimmed.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid library folder path')
  }
  return trimmed || DEFAULT_FOLDER
}

/**
 * Resolve the library folder: an explicit argument wins, otherwise the saved
 * `nc-book-pwa.folder` override from Settings is used, else `DEFAULT_FOLDER`.
 */
function resolveFolder(folder?: string): string {
  if (folder !== undefined) return sanitizeFolder(folder)
  let stored: string | null = null
  try {
    stored = typeof localStorage !== 'undefined' ? localStorage.getItem(FOLDER_STORAGE_KEY) : null
  } catch {
    stored = null
  }
  return sanitizeFolder(stored ?? '')
}

/**
 * Full URL of the library root, with a trailing slash.
 * Throws when the server or user has not been configured yet.
 *
 * When `folder` is omitted, the `nc-book-pwa.folder` setting is read from
 * `localStorage` (falling back to `DEFAULT_FOLDER`), so changing the folder in
 * Settings takes effect on the next reload.
 */
export function getDavBasePath(folder?: string): string {
  const server = getCurrentServer()
  const user = getCurrentUser()
  if (!server) {
    throw new Error('Nextcloud server not configured')
  }
  if (!user) {
    throw new Error('Nextcloud user not authenticated')
  }
  const root = normalizeServer(server)
  const segments = encodeSegments(resolveFolder(folder))
  const prefix = segments ? `${segments}/` : ''
  return `${root}/remote.php/dav/files/${encodeURIComponent(user)}/${prefix}`
}

/** Full URL for a path relative to the library root. */
export function buildDavUrl(path: string, folder?: string): string {
  const base = getDavBasePath(folder)
  const encoded = encodeSegments(path)
  return encoded ? `${base}${encoded}` : base
}

/** Sidecar path for a PDF: `<pdfPath without .pdf>.progress.json`. */
export function sidecarPath(pdfPath: string): string {
  return `${pdfPath.replace(/\.pdf$/i, '')}${PROGRESS_SIDECAR_SUFFIX}`
}

function propText(prop: Element, localName: string): string | null {
  const el = prop.getElementsByTagNameNS('DAV:', localName)[0]
  return el?.textContent ?? null
}

function parseEntries(xml: string, folder?: string): DavEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Failed to parse WebDAV PROPFIND response')
  }

  const basePathname = decodeURIComponent(new URL(getDavBasePath(folder)).pathname)
  const responses = doc.getElementsByTagNameNS('DAV:', 'response')
  const entries: DavEntry[] = []

  for (let i = 0; i < responses.length; i++) {
    try {
      const response = responses[i]
      const hrefEl = response.getElementsByTagNameNS('DAV:', 'href')[0]
      if (!hrefEl?.textContent) continue

      const hrefPathname = decodeURIComponent(
        new URL(hrefEl.textContent.trim(), getDavBasePath(folder)).pathname,
      )
      if (!hrefPathname.startsWith(basePathname)) continue

      const relative = hrefPathname.slice(basePathname.length).replace(/\/+$/, '')
      if (relative === '') continue // the requested folder itself

      const prop = response.getElementsByTagNameNS('DAV:', 'prop')[0]
      if (!prop) continue

      const isDirectory =
        hrefPathname.endsWith('/') ||
        prop.getElementsByTagNameNS('DAV:', 'collection').length > 0

      const rawSize = propText(prop, 'getcontentlength')
      const parsedSize = rawSize ? Number.parseInt(rawSize, 10) : 0

      entries.push({
        name: relative.split('/').pop() ?? relative,
        path: relative,
        size: Number.isNaN(parsedSize) ? 0 : parsedSize,
        lastModified: propText(prop, 'getlastmodified'),
        isDirectory,
      })
    } catch {
      // Malformed entry (e.g. URIError from a bad href): skip it rather than
      // failing the whole listing.
      continue
    }
  }

  return entries
}

async function throwForStatus(response: Response, action: string, path: string): Promise<never> {
  const detail = await response.text().catch(() => '')
  const suffix = detail ? `: ${detail.slice(0, 200)}` : ''
  throw new Error(
    `WebDAV ${action} failed for "${path}" (${response.status} ${response.statusText})${suffix}`,
  )
}

/** List a folder (PROPFIND Depth: 1), excluding the folder itself. */
export async function listFolder(
  path = '',
  folder?: string,
): Promise<DavEntry[]> {
  const response = await ncFetch(buildDavUrl(path, folder), {
    method: 'PROPFIND',
    headers: {
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`,
  })

  if (!response.ok) {
    await throwForStatus(response, 'PROPFIND', path || '/')
  }

  return parseEntries(await response.text(), folder)
}

/** Download a file's bytes. */
export async function downloadFile(
  path: string,
  folder?: string,
): Promise<ArrayBuffer> {
  const response = await ncFetch(buildDavUrl(path, folder), { method: 'GET' })
  if (!response.ok) {
    await throwForStatus(response, 'GET', path)
  }
  return response.arrayBuffer()
}

/**
 * Create a collection, creating missing ancestors first.
 * Succeeds when the collection already exists (Nextcloud answers 405).
 */
export async function mkdir(path: string, folder?: string): Promise<void> {
  const relative = path.replace(/^\/+|\/+$/g, '')
  if (!relative) return

  const response = await ncFetch(buildDavUrl(relative, folder), { method: 'MKCOL' })
  if (response.ok || response.status === 405) {
    return
  }
  if (response.status === 409) {
    const parent = relative.slice(0, relative.lastIndexOf('/'))
    if (!parent) {
      await throwForStatus(response, 'MKCOL', relative)
    }
    await mkdir(parent, folder)
    return mkdir(relative, folder)
  }
  await throwForStatus(response, 'MKCOL', relative)
}

function contentTypeFor(data: ArrayBuffer | Blob | string): string {
  if (typeof data === 'string') return 'text/plain; charset=utf-8'
  if (data instanceof Blob && data.type) return data.type
  return 'application/octet-stream'
}

/** Upload bytes to a path, creating the parent collection when missing. */
export async function uploadFile(
  path: string,
  data: ArrayBuffer | Blob | string,
  folder?: string,
): Promise<void> {
  const relative = path.replace(/^\/+/, '')
  const parent = relative.slice(0, relative.lastIndexOf('/'))
  if (parent) {
    await mkdir(parent, folder)
  }

  const response = await ncFetch(buildDavUrl(relative, folder), {
    method: 'PUT',
    headers: { 'Content-Type': contentTypeFor(data) },
    body: data as BodyInit,
  })
  if (!response.ok) {
    await throwForStatus(response, 'PUT', relative)
  }
}

/** Read a PDF's progress sidecar; `null` when it does not exist (404). */
export async function readSidecar(
  pdfPath: string,
  folder?: string,
): Promise<Record<string, unknown> | null> {
  const path = sidecarPath(pdfPath)
  const response = await ncFetch(buildDavUrl(path, folder), { method: 'GET' })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    await throwForStatus(response, 'GET', path)
  }
  return (await response.json()) as Record<string, unknown>
}

/** Write a PDF's progress sidecar as JSON. */
export async function writeSidecar(
  pdfPath: string,
  obj: unknown,
  folder?: string,
): Promise<void> {
  const path = sidecarPath(pdfPath)
  const response = await ncFetch(buildDavUrl(path, folder), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  })
  if (!response.ok) {
    await throwForStatus(response, 'PUT', path)
  }
}
