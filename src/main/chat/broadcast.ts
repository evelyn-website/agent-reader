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
