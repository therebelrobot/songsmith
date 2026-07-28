import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds straight into ../public, which the Fastify server serves and falls
// back to for client-side routes. One container, one port, no CORS.
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5180', '/healthz': 'http://localhost:5180' },
  },
});
