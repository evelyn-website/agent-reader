#!/usr/bin/env node
// SessionStart hook for agent-reader. Claude pipes a JSON object to stdin
// containing `session_id`; we write that id to AGENT_READER_SESSION_ID_FILE
// so the main process can correlate the pty with claude's transcript UUID.
// All output is suppressed; failure is silent because the JSONL filename
// watcher in the main process is the fallback discovery path.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeFileSync } = require('fs')

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
})
process.stdin.on('end', () => {
  try {
    const dest = process.env.AGENT_READER_SESSION_ID_FILE
    if (!dest) return
    const payload = JSON.parse(buf)
    const id = payload && typeof payload.session_id === 'string' ? payload.session_id : null
    if (!id) return
    writeFileSync(dest, id)
  } catch {
    // swallow — fallback discovery owns the failure case
  }
})
