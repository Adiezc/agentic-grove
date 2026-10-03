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
import { CONTENT_SECURITY_POLICY } from './electron/page-rules.ts'

export default defineConfig({
  plugins: [
    react(),
    // The content security policy goes into the built page only. The development server's hot
    // reloading injects scripts of its own, which the policy would rightly refuse.
    {
      name: 'grove-content-security-policy',
      apply: 'build',
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
      ],
    },
    electron({
      main: { entry: 'electron/main.ts' },
      preload: { input: 'electron/preload.ts' },
    }),
  ],
  build: {
    outDir: 'dist',
  },
})
