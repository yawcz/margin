import { resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import express from 'express';
import { createApp } from './app.ts';
import { CodexProvider } from './codex.ts';

const dataDir = resolve(process.env.DATA_DIR || 'data');
const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !process.env.APP_PASSWORD)
  throw new Error('Set APP_PASSWORD before listening on a network interface.');
if (process.env.APP_PASSWORD && process.env.APP_PASSWORD.length < 12)
  throw new Error('APP_PASSWORD must be at least 12 characters.');
mkdirSync(join(dataDir, 'agent-workspace'), { recursive: true, mode: 0o700 });
const provider = new CodexProvider(join(dataDir, 'agent-workspace'));
const { app, close } = createApp({
  dataDir,
  provider,
  password: process.env.APP_PASSWORD,
  secureCookies: process.env.COOKIE_SECURE === 'true',
  publicOrigin: process.env.PUBLIC_ORIGIN,
});
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4317);
const server = app.listen(port, host, () =>
  console.log(`Margin is available at http://${host}:${port}`),
);
const shutdown = () => {
  server.close(() => {
    close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
