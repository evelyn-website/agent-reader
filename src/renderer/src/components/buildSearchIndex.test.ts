import { describe, it, expect } from 'vitest'
import { buildSearchIndex } from './buildSearchIndex'

function makePdf(pageTexts: string[]) {
  return {
    numPages: pageTexts.length,
    getPage: async (n: number) => ({
      getTextContent: async () => ({
        items: [{ str: pageTexts[n - 1] }]
      })
    })
  }
}

describe('buildSearchIndex', () => {
  it('returns correct numPages', async () => {
    const pdf = makePdf(['a', 'b', 'c'])
    const index = await buildSearchIndex(pdf)
    expect(index.numPages).toBe(3)
  })

  it('extracts text from each page into 1-based arrays', async () => {
    const pdf = makePdf(['first page', 'second page', 'third page'])
    const index = await buildSearchIndex(pdf)
    expect(index.pageTexts[1]).toBe('first page')
    expect(index.pageTexts[2]).toBe('second page')
    expect(index.pageTexts[3]).toBe('third page')
    expect(index.pageTexts[0]).toBe('')
  })

  it('stores lowercase version in pageTextsLower', async () => {
    const pdf = makePdf(['Hello World'])
    const index = await buildSearchIndex(pdf)
    expect(index.pageTextsLower[1]).toBe('hello world')
  })

  it('collapses whitespace and trims', async () => {
    const pdf = {
      numPages: 1,
      getPage: async (_n: number) => ({
        getTextContent: async () => ({
          items: [{ str: '  hello  ' }, { str: '  world  ' }]
        })
      })
    }
    const index = await buildSearchIndex(pdf)
    expect(index.pageTexts[1]).toBe('hello world')
  })

  it('handles an empty page (no items)', async () => {
    const pdf = {
      numPages: 1,
      getPage: async (_n: number) => ({
        getTextContent: async () => ({ items: [] })
      })
    }
    const index = await buildSearchIndex(pdf)
    expect(index.pageTexts[1]).toBe('')
  })

  it('correctly indexes all pages across a batch boundary (9 pages, BATCH_SIZE=8)', async () => {
    const texts = Array.from({ length: 9 }, (_, i) => `page ${i + 1} text`)
    const pdf = makePdf(texts)
    const index = await buildSearchIndex(pdf)
    expect(index.numPages).toBe(9)
    for (let i = 1; i <= 9; i++) {
      expect(index.pageTexts[i]).toBe(`page ${i} text`)
    }
  })

  it('throws AbortError when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const pdf = makePdf(['hello'])
    await expect(buildSearchIndex(pdf, controller.signal)).rejects.toThrow('aborted')
  })

  it('throws AbortError when signal fires between batches', async () => {
    const controller = new AbortController()
    let pagesFetched = 0
    const pdf = {
      numPages: 9,
      getPage: async (n: number) => {
        pagesFetched++
        if (pagesFetched >= 8) controller.abort()
        return {
          getTextContent: async () => ({ items: [{ str: `p${n}` }] })
        }
      }
    }
    await expect(buildSearchIndex(pdf, controller.signal)).rejects.toThrow('aborted')
  })
})
