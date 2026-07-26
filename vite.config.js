import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleTTSRequest } from './server/tts.js'
import { handleDictationRequest } from './server/dictation.js'

// The dev/preview servers must expose the same endpoints as the standalone
// production server (server/serve.js), including /health: the app's warm-up
// check pings it, and without it Vite's SPA fallback answers with index.html
// (HTTP 200, text/html), which is not a valid health response.
function handleHealthRequest(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'dictationapp-vite' }));
}

function useAppMiddlewares(server) {
  server.middlewares.use('/health', handleHealthRequest);
  server.middlewares.use('/api/tts', handleTTSRequest);
  server.middlewares.use('/api/dictation', handleDictationRequest);
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
  plugins: [
    react(),
    edgeTTSPlugin()
  ],
})
