import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexProvider } from '../server/codex.ts';
import { Store, type StoredPaper } from '../server/store.ts';
import type { TutorRequest } from '../server/tutor.ts';

const disabledFeatures = [
  'shell_tool',
  'unified_exec',
  'unified_exec_tty',
  'multi_agent',
  'browser_use',
  'computer_use',
  'apps',
  'code_mode_host',
  'plugins',
  'image_generation',
  'view_image',
];

async function fixture(dir: string, name: string) {
  const binary = join(dir, name);
  await writeFile(binary, await readFile(new URL(`./fixtures/${name}`, import.meta.url)), {
    mode: 0o700,
  });
  return binary;
}
async function calls(dir: string) {
  return (await readFile(join(dir, 'calls.jsonl'), 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
function sampleRequest(store: Store): TutorRequest {
  return {
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
}

test('Codex discovers paginated effort options and sends the selected model, effort, supported inputs and a locked-down thread', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'margin-codex-test-'));
  const binary = await fixture(dir, 'codex-server.mjs');
  const store = new Store(dir);
  const provider = new CodexProvider(dir, binary);
  try {
    const catalog = await provider.models();
    assert.deepEqual(
      catalog.models.map((m) => m.id),
      ['image-model', 'text-model'],
    );
    assert.equal(catalog.defaultModel, 'image-model');
    assert.equal(catalog.models[0].supportsImages, true);
    assert.equal(catalog.models[1].supportsImages, false);
    assert.ok(!JSON.stringify(catalog).includes('test-only-private-value'));
    const request = sampleRequest(store);
    await provider.answer(request);
    await provider.answer({ ...request, generation: { model: 'text-model', effort: 'low' } });
    await assert.rejects(
      provider.answer({ ...request, generation: { model: 'text-model', effort: 'high' } }),
      /not supported/,
    );
    const recorded = await calls(dir);
    const threads = recorded.filter((c) => c.method === 'thread/start');
    const turns = recorded.filter((c) => c.method === 'turn/start');
    assert.deepEqual(
      threads.map((c) => c.params.model),
      ['image-model', 'text-model'],
    );
    for (const feature of disabledFeatures)
      assert.equal(threads[0].params.config[`features.${feature}`], false, feature);
    assert.deepEqual(threads[0].params.config.mcp_servers, {});
    assert.equal('features.apply_patch_freeform' in threads[0].params.config, false);
    assert.equal(threads[0].params.approvalPolicy, 'never');
    assert.equal(threads[0].params.sandbox, 'read-only');
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
    assert.equal(
      recorded.filter((c) => c.method === 'thread/unsubscribe').length,
      2,
      'each completed turn releases its ephemeral thread',
    );
  } finally {
    provider.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a Codex hang-up rejects the pending answer with a retryable error and does not crash the server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'margin-codex-hangup-'));
  const binary = await fixture(dir, 'codex-hangup.mjs');
  const store = new Store(dir);
  const provider = new CodexProvider(dir, binary);
  const log = mock.method(console, 'error', () => {});
  try {
    const request = sampleRequest(store);
    for (let attempt = 0; attempt < 2; attempt++) {
      let failure: unknown;
      await provider.answer(request).catch((error) => (failure = error));
      assert.ok(failure instanceof Error, 'the answer is rejected');
      assert.equal((failure as { status?: number }).status, 503);
      assert.match(failure.message, /Codex/);
    }
    const status = await provider.status();
    assert.equal(status.available, false);
    assert.match(status.detail, /Codex/);
  } finally {
    log.mock.restore();
    provider.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a stalled turn is interrupted and its thread released after the tutor timeout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'margin-codex-stall-'));
  const binary = await fixture(dir, 'codex-stall.mjs');
  const store = new Store(dir);
  const provider = new CodexProvider(dir, binary, 200);
  try {
    const started = Date.now();
    await assert.rejects(
      provider.answer({ ...sampleRequest(store), generation: undefined }),
      /took too long/,
    );
    assert.ok(Date.now() - started < 5000, 'the configured timeout is honoured');
    let recorded = await calls(dir);
    for (let i = 0; i < 100 && !recorded.some((c) => c.method === 'thread/unsubscribe'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      recorded = await calls(dir);
    }
    const methods = recorded.map((c) => c.method);
    assert.ok(methods.includes('turn/start'));
    assert.ok(methods.indexOf('turn/interrupt') > methods.indexOf('turn/start'));
    assert.ok(methods.indexOf('thread/unsubscribe') > methods.indexOf('turn/interrupt'));
    assert.deepEqual(recorded.find((c) => c.method === 'turn/interrupt').params, {
      threadId: 'stalled-thread',
      turnId: 'turn-1',
    });
    assert.deepEqual(
      recorded.filter((c) => c.method === 'turn/start').map((c) => c.params.model),
      ['slow-model'],
    );
  } finally {
    provider.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a turn acknowledged after timeout is still interrupted and released', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'margin-codex-late-'));
  const binary = await fixture(dir, 'codex-stall.mjs');
  await writeFile(join(dir, 'delay-turn'), '');
  const store = new Store(dir);
  const provider = new CodexProvider(dir, binary, 100);
  try {
    await assert.rejects(
      provider.answer({ ...sampleRequest(store), generation: undefined }),
      /took too long/,
    );
    let recorded = await calls(dir);
    for (let i = 0; i < 100 && !recorded.some((call) => call.method === 'turn/interrupt'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      recorded = await calls(dir);
    }
    assert.deepEqual(recorded.find((call) => call.method === 'turn/interrupt')?.params, {
      threadId: 'stalled-thread',
      turnId: 'turn-1',
    });
    assert.ok(recorded.some((call) => call.method === 'thread/unsubscribe'));
  } finally {
    provider.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

for (const mode of ['rejected', 'timed out']) {
  test(`${mode} initialization terminates its process without disrupting its replacement`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'margin-codex-restart-'));
    const binary = await fixture(dir, 'codex-restart.mjs');
    if (mode === 'timed out') await writeFile(join(dir, 'timeout-initialize'), '');
    const provider = new CodexProvider(dir, binary, 1000, 150);
    try {
      assert.equal((await provider.status()).available, false);
      assert.equal((await provider.status()).authenticated, true);
      let lifecycle = '';
      for (let i = 0; i < 100 && !lifecycle.includes('exited'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        lifecycle = await readFile(join(dir, 'lifecycle.jsonl'), 'utf8').catch(() => '');
      }
      assert.match(lifecycle, /terminating\nexited/);
      assert.equal((await provider.status()).authenticated, true);
    } finally {
      provider.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
