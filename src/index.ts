import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import songRoutes from './routes/songs';
import lineRoutes from './routes/lines';
import prosodyRoutes from './routes/prosody';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5180);
const HOST = process.env.HOST ?? '0.0.0.0';
const TOKEN = process.env.SONGSMITH_TOKEN ?? '';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Set because this sits behind Nginx Proxy Manager; without it every request
  // logs the proxy's IP and rate limiting later would key on the wrong address.
  trustProxy: true,
  bodyLimit: 1_000_000,
});

// Single shared bearer token. Unset = open, which is correct for a LAN-only
// first run; set it before you expose the host through the proxy.
if (TOKEN) {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const header = req.headers.authorization ?? '';
    if (header !== `Bearer ${TOKEN}`) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
} else {
  app.log.warn('SONGSMITH_TOKEN is unset — the API is unauthenticated');
}

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: 'validation failed', issues: err.issues });
  }
  app.log.error(err);
  return reply.code(err.statusCode ?? 500).send({ error: err.message });
});

app.get('/healthz', async () => ({ ok: true }));

await app.register(songRoutes);
await app.register(lineRoutes);
await app.register(prosodyRoutes);

// Phase 1 ships no UI. When the Vite build lands in public/, this serves it and
// falls through to index.html so client-side routing works.
const publicDir = join(here, '..', 'public');
if (existsSync(join(publicDir, 'index.html'))) {
  await app.register(fastifyStatic, { root: publicDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: PORT, host: HOST });
