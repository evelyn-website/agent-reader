import { BrowserWindow } from 'electron'

export interface SessionsChangedEvent {
  sessionId: string
  scopeKey: string
}

export function broadcastSessionsChanged(event: SessionsChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    const wc = win.webContents
    if (!wc || wc.isDestroyed()) continue
    wc.send('chat:sessions:changed', event)
  }
}

export interface AnnotationsChangedEvent {
  documentId: string
}

export function broadcastAnnotationsChanged(event: AnnotationsChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    const wc = win.webContents
    if (!wc || wc.isDestroyed()) continue
    wc.send('annotations:changed', event)
  }
}
