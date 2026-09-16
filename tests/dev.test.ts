import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createApp } from '../server/app.ts';
import { createDevServer } from '../server/dev.ts';
import { TestProvider } from './fixtures.ts';

test('development serves the app and PDF assets without exposing private storage', async () => {
  const dataDir = await mkdtemp(join(process.cwd(), '.margin-private-'));
  await writeFile(join(dataDir, 'private.txt'), 'private test data');
  const instance = createApp({
    dataDir,
    provider: new TestProvider(),
    password: 'test-password-only',
  });
  const vite = await createDevServer(dataDir);
  instance.app.use(vite.middlewares);
  const server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${root}/`)).status, 200);
    const entry = await fetch(`${root}/src/main.tsx`);
    assert.equal(entry.status, 200);
    for (const dependency of (await entry.text()).matchAll(/"([^"]*\/\.vite\/deps\/[^"]+)"/g)) {
      const response = await fetch(`${root}${dependency[1]}`);
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    assert.equal((await fetch(`${root}/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap`)).status, 200);
    assert.equal((await fetch(`${root}/api/papers`)).status, 401);
    for (const file of ['private.txt', 'margin.sqlite', 'margin.sqlite-wal']) {
      for (const prefix of [`/${basename(dataDir)}`, `/@fs${dataDir}`]) {
        for (const suffix of ['', '?raw', '?raw&import']) {
          const response = await fetch(`${root}${prefix}/${file}${suffix}`);
          assert.equal(response.status, 403, `${prefix}/${file}${suffix}`);
          assert.ok(!(await response.text()).includes('private test data'));
        }
      }
    }
  } finally {
    await vite.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    instance.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
