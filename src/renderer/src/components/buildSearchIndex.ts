interface TextItem {
  str: string
  hasEOL?: boolean
}

interface PageProxy {
  getTextContent: () => Promise<{ items: TextItem[] }>
}

interface PdfLike {
  numPages: number
  getPage: (n: number) => Promise<PageProxy>
}

export interface SearchIndex {
  numPages: number
  pageTexts: string[]
  pageTextsLower: string[]
}

const BATCH_SIZE = 8

export async function buildSearchIndex(
  pdf: PdfLike,
  signal?: AbortSignal
): Promise<SearchIndex> {
  const n = pdf.numPages
  const pageTexts: string[] = new Array(n + 1).fill('')
  const pageTextsLower: string[] = new Array(n + 1).fill('')

  for (let start = 1; start <= n; start += BATCH_SIZE) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const end = Math.min(n, start + BATCH_SIZE - 1)
    const pages = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, i) => pdf.getPage(start + i))
    )
    const contents = await Promise.all(pages.map((p) => p.getTextContent()))
    for (let i = 0; i < contents.length; i++) {
      const text = contents[i].items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim()
      const idx = start + i
      pageTexts[idx] = text
      pageTextsLower[idx] = text.toLowerCase()
    }
  }

  return { numPages: n, pageTexts, pageTextsLower }
}
