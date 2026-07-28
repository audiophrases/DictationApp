import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { handleAppRequest } from './server/routes.js'

// One catch-all instead of a middleware per endpoint: the route table lives in
// server/routes.js, shared with the standalone production server, so dev and
// production can't answer differently. That includes /health — the app's
// warm-up check pings it, and without it Vite's SPA fallback would answer with
// index.html (HTTP 200, text/html), which is not a valid health response.
function useAppMiddlewares(server) {
  server.middlewares.use((req, res, next) => {
    handleAppRequest(req, res, { service: 'dictationapp-vite' })
      .then((handled) => { if (!handled) next() })
      .catch(next)
  })
}

function edgeTTSPlugin() {
  return {
    name: 'edge-tts-plugin',
    configureServer: useAppMiddlewares,
    // Same endpoints for `vite preview`, so a production build works too
    configurePreviewServer: useAppMiddlewares,
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  // Relative asset URLs, so one build runs from any mount point: the repo root
  // on Render and in the portable pack, /DictationApp/ on GitHub Pages. The app
  // has no path-based routes (only ?a=CODE), so nothing else needs rewriting.
  base: './',
  build: {
    // Two pages, not one app with a route: the student app at the root and the
    // teacher's at create/. A static host has no rewrites, so /create/ has to
    // be a real directory with a real index.html — and keeping them separate
    // means a Chromebook loading the student app never downloads the
    // dashboard, the assignment builder or anything behind the password.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        create: resolve(import.meta.dirname, 'create/index.html'),
      },
    },
  },
  plugins: [
    react(),
    edgeTTSPlugin()
  ],
})
