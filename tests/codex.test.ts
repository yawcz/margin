import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexProvider } from '../server/codex.ts';
import { Store, type StoredPaper } from '../server/store.ts';
import type { TutorRequest } from '../server/tutor.ts';

test('Codex discovers paginated effort options and sends the selected model, effort, and supported inputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'margin-codex-test-'));
  const binary = join(dir, 'codex-fixture.mjs');
  await writeFile(binary, await readFile(new URL('./fixtures/codex-server.mjs', import.meta.url)), {
    mode: 0o700,
  });
  const store = new Store(dir);
  const provider = new CodexProvider(dir, binary);
  try {
    const catalog = await provider.models();
    assert.deepEqual(
      catalog.models.map((m) => m.id),
      ['image-model', 'text-model'],
    );
    assert.equal(catalog.models[0].supportsImages, true);
    assert.equal(catalog.models[1].supportsImages, false);
    assert.ok(!JSON.stringify(catalog).includes('test-only-private-value'));
    const request: TutorRequest = {
      paper: {
        title: 'Test paper',
        source: '',
        pages: 1,
        pageTexts: ['A line through the origin.'],
      } as StoredPaper,
      library: [],
      readingPath: [],
      profile: store.profile(),
      messages: [],
      action: 'chat',
      question: 'What is a span?',
      selection: '',
      page: 1,
      imagePath: '/test/page.png',
      generation: { model: 'image-model', effort: 'high' },
    };
    await provider.answer(request);
    await provider.answer({ ...request, generation: { model: 'text-model', effort: 'low' } });
    await assert.rejects(
      provider.answer({ ...request, generation: { model: 'text-model', effort: 'high' } }),
      /not supported/,
    );
    const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const threads = calls.filter((c) => c.method === 'thread/start');
    const turns = calls.filter((c) => c.method === 'turn/start');
    assert.deepEqual(
      threads.map((c) => c.params.model),
      ['image-model', 'text-model'],
    );
    assert.deepEqual(
      turns.map((c) => [c.params.model, c.params.effort]),
      [
        ['image-model', 'high'],
        ['text-model', 'low'],
      ],
    );
    assert.equal(
      turns[0].params.input.some((item: any) => item.type === 'localImage'),
      true,
    );
    assert.equal(
      turns[1].params.input.some((item: any) => item.type === 'localImage'),
      false,
    );
  } finally {
    provider.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
