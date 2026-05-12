import { pdfjs } from 'react-pdf'
import { createDebug } from '../lib/debug'
import type { OutlineNode } from './loadToc'

export type PDFDocumentProxy = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>

interface DocMeta {
  dims: Map<number, number>
  outline: OutlineNode[]
}

const dPerf = createDebug('pdf:perf')
const MAX = 4
const cache = new Map<string, PDFDocumentProxy>()
const inflight = new Map<string, Promise<PDFDocumentProxy>>()
const metaCache = new Map<string, DocMeta>()

export function getMeta(documentId: string): DocMeta | undefined {
  return metaCache.get(documentId)
}

export function setMeta(documentId: string, meta: DocMeta): void {
  metaCache.set(documentId, meta)
}

export async function getOrLoad(documentId: string, data: Buffer): Promise<PDFDocumentProxy> {
  const t0 = performance.now()
  const hit = cache.get(documentId)
  if (hit) {
    cache.delete(documentId)
    cache.set(documentId, hit)
    dPerf(`cache HIT  ${documentId.slice(0, 8)} ${(performance.now() - t0).toFixed(1)}ms (size=${cache.size})`)
    return hit
  }
  const pending = inflight.get(documentId)
  if (pending) {
    dPerf(`cache JOIN ${documentId.slice(0, 8)} (in-flight)`)
    return pending
  }
  const tCopy = performance.now()
  const bytes = new Uint8Array(data.byteLength)
  bytes.set(data)
  const tGet = performance.now()
  const loadPromise = pdfjs.getDocument({ data: bytes }).promise
  inflight.set(documentId, loadPromise)
  let proxy: PDFDocumentProxy
  try {
    proxy = await loadPromise
  } finally {
    inflight.delete(documentId)
  }
  const tDone = performance.now()
  cache.set(documentId, proxy)
  dPerf(
    `cache MISS ${documentId.slice(0, 8)} total=${(tDone - t0).toFixed(1)}ms ` +
      `copy=${(tGet - tCopy).toFixed(1)}ms getDocument=${(tDone - tGet).toFixed(1)}ms (size=${cache.size})`
  )
  while (cache.size > MAX) {
    const oldestId = cache.keys().next().value as string
    const old = cache.get(oldestId)
    cache.delete(oldestId)
    metaCache.delete(oldestId)
    void old?.destroy().catch(() => {})
  }
  return proxy
}

export function evict(documentId: string): void {
  const p = cache.get(documentId)
  if (!p) return
  cache.delete(documentId)
  metaCache.delete(documentId)
  void p.destroy().catch(() => {})
}

export function clearAll(): void {
  for (const p of cache.values()) void p.destroy().catch(() => {})
  cache.clear()
  metaCache.clear()
}
