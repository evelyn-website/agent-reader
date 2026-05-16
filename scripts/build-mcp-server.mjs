// Bundle src/main/mcp/server.ts into resources/mcp-server/index.js.
// The output is what claude executes per-session via `--mcp-config`.
// Externals: better-sqlite3 is a native module; we resolve it at runtime
// from the Electron app's node_modules (via ELECTRON_RUN_AS_NODE).
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [resolve(root, 'src/main/mcp/server.ts')],
  outfile: resolve(root, 'resources/mcp-server/index.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['better-sqlite3'],
  logLevel: 'info'
})
