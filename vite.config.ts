/**
 * One build, three outputs.
 *
 * Vite builds the renderer (everything under `src/`) the way it builds any React app. The
 * Electron plugin additionally builds the two node-side entry points — the main process and the
 * preload script — into `dist-electron/`, and in development it launches Electron for us and
 * restarts it when either one changes.
 *
 * `npm run dev` therefore does the whole thing, and there is no separate "compile the Electron
 * half" step to forget.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: { entry: 'electron/main.ts' },
      preload: { input: 'electron/preload.ts' },
    }),
  ],
  build: {
    outDir: 'dist',
  },
})
