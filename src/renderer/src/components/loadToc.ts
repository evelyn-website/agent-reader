export interface OutlineNode {
  title: string
  pageNumber: number | null
  children: OutlineNode[]
}

interface RawOutlineItem {
  title: string
  dest: string | unknown[] | null
  items: RawOutlineItem[]
}

interface PdfRef {
  num: number
  gen: number
}

interface LinkAnnotation {
  subtype: string
  dest?: string | unknown[] | null
  url?: string | null
  rect: [number, number, number, number]
}

interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

interface PageProxy {
  getAnnotations: () => Promise<LinkAnnotation[]>
  getTextContent: () => Promise<{ items: TextItem[] }>
}

interface PdfLike {
  numPages: number
  getOutline: () => Promise<RawOutlineItem[] | null>
  getDestination: (name: string) => Promise<unknown[] | null>
  getPageIndex: (ref: PdfRef) => Promise<number>
  getPage: (n: number) => Promise<PageProxy>
}

const MAX_SCAN_PAGES = 100
const PRE_TOC_BUDGET = 20
const MIN_LINKS_PER_TOC_PAGE = 5
const MIN_TOTAL_ENTRIES = 5
const MIN_MONOTONIC_RATIO = 0.8

const DEBUG = false
const log = (...args: unknown[]): void => {
  if (DEBUG) console.log('[toc]', ...args)
}

async function resolveDest(
  pdf: PdfLike,
  dest: string | unknown[] | null | undefined
): Promise<number | null> {
  if (!dest) return null
  const arr = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
  if (!arr || arr.length === 0) return null
  const ref = arr[0] as PdfRef
  if (!ref || typeof ref.num !== 'number') return null
  try {
    const idx = await pdf.getPageIndex(ref)
    return idx + 1
  } catch {
    return null
  }
}

async function resolveItem(pdf: PdfLike, item: RawOutlineItem): Promise<OutlineNode> {
  const [pageNumber, children] = await Promise.all([
    resolveDest(pdf, item.dest),
    Promise.all(item.items.map((c) => resolveItem(pdf, c)))
  ])
  return { title: item.title, pageNumber, children }
}

async function loadEmbeddedOutline(pdf: PdfLike): Promise<OutlineNode[]> {
  const raw = await pdf.getOutline()
  if (!raw || raw.length === 0) return []
  return Promise.all(raw.map((item) => resolveItem(pdf, item)))
}

function extractLinkText(
  rect: [number, number, number, number],
  items: TextItem[]
): { text: string; textLeftX: number | null } {
  const [x1, y1, x2, y2] = rect
  const matches: { x: number; str: string }[] = []
  for (const item of items) {
    const tx = item.transform[4]
    const ty = item.transform[5]
    if (ty < y1 || ty > y2) continue
    if (tx + item.width < x1 || tx > x2) continue
    matches.push({ x: tx, str: item.str })
  }
  matches.sort((a, b) => a.x - b.x)
  const joined = matches
    .map((m) => m.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const text = joined.replace(/[\s.…]+\d+\s*$/, '').trim()
  const firstReal = matches.find((m) => m.str.trim().length > 0)
  return { text, textLeftX: firstReal ? firstReal.x : null }
}

interface LinkEntry {
  title: string
  pageNumber: number
  leftX: number
}

function destKey(dest: string | unknown[] | null | undefined): string | null {
  if (!dest) return null
  if (typeof dest === 'string') return `name:${dest}`
  try {
    return `arr:${JSON.stringify(dest)}`
  } catch {
    return null
  }
}

interface PageScanResult {
  entries: LinkEntry[]
  internalLinkCount: number
}

async function extractLinksFromPage(pdf: PdfLike, pageNum: number): Promise<PageScanResult> {
  const page = await pdf.getPage(pageNum)
  const [annotations, textContent] = await Promise.all([
    page.getAnnotations(),
    page.getTextContent()
  ])
  const allLinks = annotations.filter((a) => a.subtype === 'Link')
  const internalLinks = allLinks.filter((a) => a.dest != null && !a.url)
  log(
    `page ${pageNum}: annotations=${annotations.length}, link annotations=${allLinks.length}, internal links=${internalLinks.length}`
  )
  if (internalLinks.length === 0) {
    return { entries: [], internalLinkCount: 0 }
  }

  const grouped = new Map<string, LinkAnnotation[]>()
  let nullKeyed = 0
  for (const link of internalLinks) {
    const key = destKey(link.dest)
    if (key === null) {
      nullKeyed++
      continue
    }
    const bucket = grouped.get(key)
    if (bucket) bucket.push(link)
    else grouped.set(key, [link])
  }
  log(`page ${pageNum}: groups=${grouped.size}, null-keyed=${nullKeyed}`)

  const resolved = await Promise.all(
    Array.from(grouped.entries()).map(async ([key, group]) => {
      const target = await resolveDest(pdf, group[0].dest)
      if (target === null) {
        log(`page ${pageNum}: dropped group key=${key} (dest unresolved)`)
        return null
      }
      const sorted = [...group].sort((a, b) => b.rect[3] - a.rect[3])
      const parts = sorted.map((link) => extractLinkText(link.rect, textContent.items))
      const title = parts
        .map((p) => p.text)
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!title) {
        log(
          `page ${pageNum}: dropped group key=${key} target=${target} (empty title; rects=`,
          group.map((l) => l.rect),
          ', parts=',
          parts,
          ')'
        )
        return null
      }
      if (/^\d+$/.test(title)) {
        log(
          `page ${pageNum}: dropped group key=${key} target=${target} (numeric-only title "${title}")`
        )
        return null
      }
      const textXs = parts.map((p) => p.textLeftX).filter((x): x is number => x !== null)
      const rawLeft =
        textXs.length > 0 ? Math.min(...textXs) : Math.min(...group.map((l) => l.rect[0]))
      const leftX = Math.round(rawLeft / 2) * 2
      return { title, pageNumber: target, leftX }
    })
  )
  const entries = resolved.filter((e): e is LinkEntry => e !== null)
  log(`page ${pageNum}: kept ${entries.length} entries`)
  return { entries, internalLinkCount: internalLinks.length }
}

async function scanLinkToc(pdf: PdfLike): Promise<OutlineNode[]> {
  const limit = Math.min(MAX_SCAN_PAGES, pdf.numPages)
  log(`scan start: numPages=${pdf.numPages}, limit=${limit}`)
  const all: LinkEntry[] = []
  let foundToc = false
  let prevWasSubMin = false
  for (let i = 1; i <= limit; i++) {
    if (!foundToc && i > PRE_TOC_BUDGET) {
      log(`scan stopped: pre-TOC budget exceeded after page ${i - 1}`)
      break
    }
    const result = await extractLinksFromPage(pdf, i)
    if (!foundToc) {
      if (result.internalLinkCount >= MIN_LINKS_PER_TOC_PAGE) {
        foundToc = true
        all.push(...result.entries)
        prevWasSubMin = false
      }
      continue
    }
    if (result.internalLinkCount === 0) {
      log(`scan stopped: page ${i} has no internal links after TOC region`)
      break
    }
    const isSubMin = result.internalLinkCount < MIN_LINKS_PER_TOC_PAGE
    if (isSubMin && prevWasSubMin) {
      log(`scan stopped: page ${i} is the second consecutive sub-min page (excluded)`)
      break
    }
    all.push(...result.entries)
    prevWasSubMin = isSubMin
  }
  log(`scan complete: total entries=${all.length}`)
  if (all.length < MIN_TOTAL_ENTRIES) {
    log(`rejected: fewer than MIN_TOTAL_ENTRIES (${MIN_TOTAL_ENTRIES})`)
    return []
  }

  let nonDecreasing = 0
  for (let i = 1; i < all.length; i++) {
    if (all[i].pageNumber >= all[i - 1].pageNumber) nonDecreasing++
  }
  const ratio = nonDecreasing / (all.length - 1)
  log(`monotonic ratio: ${ratio.toFixed(3)} (threshold ${MIN_MONOTONIC_RATIO})`)
  if (ratio < MIN_MONOTONIC_RATIO) {
    log(`rejected: monotonic ratio below threshold`)
    return []
  }

  const seen = new Set<string>()
  const deduped: LinkEntry[] = []
  for (const entry of all) {
    const key = `${entry.pageNumber}::${entry.title}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }
  log(`deduped entries=${deduped.length} (from ${all.length})`)

  const tree = buildHierarchy(deduped)
  log(`final tree top-level=${tree.length}`)
  return tree
}

const INDENT_CLUSTER_GAP = 6

function buildHierarchy(entries: LinkEntry[]): OutlineNode[] {
  if (entries.length === 0) return []
  const xs = [...new Set(entries.map((e) => e.leftX))].sort((a, b) => a - b)
  const clusterOf = new Map<number, number>()
  let cluster = 0
  clusterOf.set(xs[0], 0)
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] >= INDENT_CLUSTER_GAP) cluster++
    clusterOf.set(xs[i], cluster)
  }
  log(`indent clusters: ${cluster + 1} (xs=${xs.join(',')})`)

  const root: OutlineNode[] = []
  const stack: { depth: number; node: OutlineNode }[] = []
  for (const entry of entries) {
    const depth = clusterOf.get(entry.leftX) ?? 0
    const node: OutlineNode = { title: entry.title, pageNumber: entry.pageNumber, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length === 0) root.push(node)
    else stack[stack.length - 1].node.children.push(node)
    stack.push({ depth, node })
  }
  return root
}

export async function loadToc(pdf: PdfLike): Promise<OutlineNode[]> {
  const linkToc = await scanLinkToc(pdf)
  if (linkToc.length > 0) {
    log(`using link-scan TOC (${linkToc.length} entries)`)
    return linkToc
  }
  log(`falling back to embedded outline`)
  const outline = await loadEmbeddedOutline(pdf)
  log(`embedded outline entries=${outline.length}`)
  return outline
}
