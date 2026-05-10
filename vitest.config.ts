import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: [],
        // ELECTRON_RUN_AS_NODE isn't propagated to fork()'d children by Electron,
        // so re-inject it here so worker processes also run as Node.
        env: {
          ELECTRON_RUN_AS_NODE: '1'
        }
      }
    },
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts'],
          globals: true
        }
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@renderer': resolve(__dirname, 'src/renderer/src')
          }
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/renderer/test-setup.ts'],
          globals: true
        }
      }
    ]
  }
})
