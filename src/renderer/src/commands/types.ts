export type CommandSection =
  | 'File'
  | 'Project'
  | 'View'
  | 'Navigation'
  | 'Panels'
  | 'Chat'
  | 'Annotation'

export const COMMAND_SECTION_ORDER: CommandSection[] = [
  'File',
  'Project',
  'Panels',
  'View',
  'Navigation',
  'Annotation',
  'Chat'
]

export interface Command {
  id: string
  title: string
  section: CommandSection
  /**
   * Shortcut spec like `mod+shift+n`. Tokens: `mod` (Cmd/Meta on macOS),
   * `shift`, `alt`, `ctrl`. Final token is the key (case-insensitive single
   * character or named key). Omitted commands are palette-only.
   */
  shortcut?: string
  /** Extra fuzzy-match terms ("preferences", "settings", etc.). */
  keywords?: string[]
  /** Hides the command from the palette and disables hotkey dispatch. */
  isAvailable?: () => boolean
  run: () => void | Promise<void>
}
