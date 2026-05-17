import { useState, useEffect, useCallback, useMemo } from 'react'
import type { UnscaledRect } from './captureSelection'

export type AnnotationKind = 'highlight' | 'note'
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange'

export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'orange']

export interface Annotation {
  id: string
  documentId: string
  pageNumber: number
  kind: AnnotationKind
  color: HighlightColor | null
  rects: UnscaledRect[] | null
  anchor: { x: number; y: number } | null
  textExcerpt: string | null
  comment: string | null
  createdAt: number
  updatedAt: number
}

interface AnnotationRow {
  id: string
  document_id: string
  page_number: number
  kind: AnnotationKind
  color: string | null
  rects_json: string | null
  anchor_x: number | null
  anchor_y: number | null
  text_excerpt: string | null
  comment: string | null
  created_at: number
  updated_at: number
}

function rowToAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    documentId: row.document_id,
    pageNumber: row.page_number,
    kind: row.kind,
    color: (row.color as HighlightColor | null) ?? null,
    rects: row.rects_json ? (JSON.parse(row.rects_json) as UnscaledRect[]) : null,
    anchor:
      row.anchor_x !== null && row.anchor_y !== null ? { x: row.anchor_x, y: row.anchor_y } : null,
    textExcerpt: row.text_excerpt,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export interface CreateHighlightInput {
  pageNumber: number
  rects: UnscaledRect[]
  color: HighlightColor
  text: string
  comment?: string
}

export interface CreateNoteInput {
  pageNumber: number
  x: number
  y: number
  comment?: string
}

export interface UseAnnotationsResult {
  byPage: Map<number, Annotation[]>
  all: Annotation[]
  createHighlight: (input: CreateHighlightInput) => Promise<Annotation | null>
  createNote: (input: CreateNoteInput) => Promise<Annotation | null>
  updateAnnotation: (
    id: string,
    patch: { color?: HighlightColor; comment?: string | null }
  ) => Promise<void>
  deleteAnnotation: (id: string) => Promise<void>
}

export function useAnnotations(documentId: string | null): UseAnnotationsResult {
  const [annotations, setAnnotations] = useState<Annotation[]>([])

  useEffect(() => {
    if (!documentId) return
    let cancelled = false
    const refetch = (): void => {
      window.api.annotations
        .list(documentId)
        .then((rows) => {
          if (cancelled) return
          setAnnotations(rows.map(rowToAnnotation))
        })
        .catch((err) => console.error('annotations list failed:', err))
    }
    refetch()
    const unsubscribe = window.api.annotations.onChanged((event) => {
      if (event.documentId === documentId) refetch()
    })
    return () => {
      cancelled = true
      unsubscribe()
      setAnnotations([])
    }
  }, [documentId])

  const byPage = useMemo(() => {
    const m = new Map<number, Annotation[]>()
    for (const a of annotations) {
      const arr = m.get(a.pageNumber)
      if (arr) arr.push(a)
      else m.set(a.pageNumber, [a])
    }
    return m
  }, [annotations])

  const createHighlight = useCallback(
    async (input: CreateHighlightInput): Promise<Annotation | null> => {
      if (!documentId) return null
      const row = await window.api.annotations.create({
        document_id: documentId,
        page_number: input.pageNumber,
        kind: 'highlight',
        color: input.color,
        rects_json: JSON.stringify(input.rects),
        text_excerpt: input.text,
        comment: input.comment ?? null
      })
      const ann = rowToAnnotation(row)
      setAnnotations((prev) => [...prev, ann])
      return ann
    },
    [documentId]
  )

  const createNote = useCallback(
    async (input: CreateNoteInput): Promise<Annotation | null> => {
      if (!documentId) return null
      const row = await window.api.annotations.create({
        document_id: documentId,
        page_number: input.pageNumber,
        kind: 'note',
        anchor_x: input.x,
        anchor_y: input.y,
        comment: input.comment ?? null
      })
      const ann = rowToAnnotation(row)
      setAnnotations((prev) => [...prev, ann])
      return ann
    },
    [documentId]
  )

  const updateAnnotation = useCallback(
    async (
      id: string,
      patch: { color?: HighlightColor; comment?: string | null }
    ): Promise<void> => {
      const row = await window.api.annotations.update(id, {
        color: patch.color,
        comment: patch.comment
      })
      if (!row) return
      const ann = rowToAnnotation(row)
      setAnnotations((prev) => prev.map((a) => (a.id === id ? ann : a)))
    },
    []
  )

  const deleteAnnotation = useCallback(async (id: string): Promise<void> => {
    await window.api.annotations.delete(id)
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
  }, [])

  return {
    byPage,
    all: annotations,
    createHighlight,
    createNote,
    updateAnnotation,
    deleteAnnotation
  }
}
