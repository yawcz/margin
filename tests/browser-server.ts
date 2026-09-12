import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';
import { createApp } from '../server/app.ts';
import { TestProvider } from './fixtures.ts';
const { app } = createApp({
  dataDir: mkdtempSync(join(tmpdir(), 'margin-browser-')),
  provider: new TestProvider(150),
});
app.use(express.static(resolve('dist')));
app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
app.listen(4318, '127.0.0.1');
