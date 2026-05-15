export interface DocumentRow {
  id: string
  filename: string
  last_path: string
  size_bytes: number
  first_opened_at: number
  last_opened_at: number
  open_count: number
}

export type ChatMessageRole = 'user' | 'assistant' | 'system'
export type ChatMessageStatus = 'complete' | 'pending' | 'error'

export interface ChatSessionRow {
  id: string
  scope_key: string
  title: string
  origin_document_id: string | null
  origin_page_number: number | null
  origin_text_excerpt: string | null
  claude_session_id: string | null
  created_at: number
  updated_at: number
  last_message_at: number | null
}

export interface ChatSessionSummary extends ChatSessionRow {
  message_count: number
  last_message_preview: string | null
}

export interface ChatMessageRow {
  id: string
  session_id: string
  role: ChatMessageRole
  content: string
  status: ChatMessageStatus
  created_at: number
  updated_at: number
  error_text: string | null
}

export interface CreateChatSessionInput {
  scope_key: string
  title?: string
  origin_document_id?: string | null
  origin_page_number?: number | null
  origin_text_excerpt?: string | null
}

export interface CreateChatMessageInput {
  session_id: string
  role: ChatMessageRole
  content: string
  status?: ChatMessageStatus
  error_text?: string | null
}

export type AnnotationKind = 'highlight' | 'note'

export interface AnnotationRow {
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

export interface CreateAnnotationInput {
  document_id: string
  page_number: number
  kind: AnnotationKind
  color?: string | null
  rects_json?: string | null
  anchor_x?: number | null
  anchor_y?: number | null
  text_excerpt?: string | null
  comment?: string | null
}

export interface UpdateAnnotationInput {
  color?: string | null
  comment?: string | null
  rects_json?: string | null
  anchor_x?: number | null
  anchor_y?: number | null
}

export interface ProjectRow {
  path: string
  name: string
  first_opened_at: number
  last_opened_at: number
  open_count: number
}

export interface ProjectDocumentSummary {
  path: string
  name: string
  document_id: string | null
  last_opened_at: number | null
  open_count: number
  mark_count: number
  highlight_count: number
  note_count: number
}

export interface ProjectMarkSummary {
  id: string
  document_id: string
  path: string
  document_name: string
  page_number: number
  kind: AnnotationKind
  color: string | null
  text_excerpt: string | null
  comment: string | null
  created_at: number
  updated_at: number
}

export interface ProjectDashboard {
  documents: ProjectDocumentSummary[]
  resumeDocument: ProjectDocumentSummary | null
  recentMarks: ProjectMarkSummary[]
  recentSessions: ChatSessionSummary[]
}
