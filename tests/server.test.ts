import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type Server } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/app.ts';
import { TestProvider, samplePdf } from './fixtures.ts';
import { paperContext, tutorPrompt } from '../server/tutor.ts';
import type { StoredPaper } from '../server/store.ts';

async function harness(password?: string, provider = new TestProvider(), publicOrigin?: string) {
  const dataDir = await mkdtemp(join(tmpdir(), 'margin-test-'));
  let instance = createApp({ dataDir, provider, password, publicOrigin });
  let server: Server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let root = `http://127.0.0.1:${(server.address() as any).port}/api`;
  let cookie = '';
  const call = async (
    path: string,
    method = 'GET',
    data?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(root + path, {
      method,
      headers: {
        ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
    });
    const value = await response.json();
    return { response, value };
  };
  return {
    provider,
    call,
    get root() {
      return root;
    },
    setCookie(value: string) {
      cookie = value;
    },
    get store() {
      return instance.store;
    },
    async restart(nextPassword = password) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      instance.close();
      password = nextPassword;
      instance = createApp({ dataDir, provider, password, publicOrigin });
      server = instance.app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      root = `http://127.0.0.1:${(server.address() as any).port}/api`;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      instance.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
async function upload(h: Awaited<ReturnType<typeof harness>>) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(samplePdf())], { type: 'application/pdf' }),
    'sample.pdf',
  );
  const { response, value } = await h.call('/papers', 'POST', form);
  assert.equal(response.status, 201);
  return value;
}
async function finished(h: Awaited<ReturnType<typeof harness>>, id: string) {
  for (let i = 0; i < 100; i++) {
    const { value } = await h.call(`/papers/${id}`);
    if (value.jobs.at(-1)?.status !== 'running') return value;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Job did not finish');
}

test('private library requires a session; login, same-origin requests, restart and logout work', async () => {
  const h = await harness('a-long-private-password');
  try {
    assert.equal((await h.call('/papers')).response.status, 401);
    assert.equal((await h.call('/login', 'POST', { password: 'wrong' })).response.status, 401);
    const login = await h.call('/login', 'POST', { password: 'a-long-private-password' });
    assert.equal(login.response.status, 200);
    assert.match(login.response.headers.get('set-cookie')!, /HttpOnly/);
    h.setCookie(login.response.headers.get('set-cookie')!.split(';')[0]);
    assert.equal((await h.call('/papers')).response.status, 200);
    assert.equal(
      (
        await h.call(
          '/profile',
          'PUT',
          { background: 'x', goals: 'x', preferences: 'x' },
          { Origin: 'https://different.example' },
        )
      ).response.status,
      403,
    );
    await h.restart();
    assert.equal((await h.call('/papers')).response.status, 200);
    await h.call('/logout', 'POST');
    assert.equal((await h.call('/papers')).response.status, 401);
  } finally {
    await h.close();
  }
});
test('PDF and page position survive restart; malformed uploads and out-of-range pages are rejected', async () => {
  const h = await harness();
  try {
    const paper = await upload(h);
    assert.equal(paper.pages, 2);
    await h.call(`/papers/${paper.id}`, 'PATCH', { currentPage: 2, status: 'read' });
    assert.equal(
      (await h.call(`/papers/${paper.id}`, 'PATCH', { currentPage: 3 })).response.status,
      400,
    );
    const invalid = new FormData();
    invalid.append('file', new Blob(['ordinary text']), 'not-a-pdf.pdf');
    assert.equal((await h.call('/papers', 'POST', invalid)).response.status, 400);
    await h.restart();
    const detail = (await h.call(`/papers/${paper.id}`)).value;
    assert.equal(detail.paper.currentPage, 2);
    assert.equal(detail.paper.status, 'read');
    assert.match(detail.pageText, /Checking the Idea/);
    assert.equal(detail.paper.pageTexts, undefined);
    const pdf = await fetch(h.root + `/papers/${paper.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get('content-type')!, /pdf/);
  } finally {
    await h.close();
  }
});
test('background tutor jobs are idempotent, persist evidence, quizzes and recommendation overrides', async () => {
  const provider = new TestProvider(80);
  const h = await harness(undefined, provider);
  try {
    const paper = await upload(h);
    const input = {
      requestId: crypto.randomUUID(),
      action: 'explain',
      question: 'Why is the subspace a line through the origin?',
      selection: 'shared direction',
      page: 1,
    };
    const [first, duplicate] = await Promise.all([
      h.call(`/papers/${paper.id}/ask`, 'POST', input),
      h.call(`/papers/${paper.id}/ask`, 'POST', input),
    ]);
    assert.equal(first.value.id, duplicate.value.id);
    let detail = await finished(h, paper.id);
    assert.equal(detail.jobs[0].status, 'complete');
    assert.equal(provider.calls.length, 1);
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].selection, 'shared direction');
    assert.equal(detail.messages[1].quizSuggested, true);
    assert.match(provider.calls[0].paper.pageTexts[0], /Concept Directions/);
    await h.call(`/messages/${detail.messages[1].id}`, 'PATCH', { quizDismissed: true });
    const rec = detail.recommendations[0];
    await h.call(`/recommendations/${rec.id}`, 'PATCH', { status: 'skipped' });
    const profile = (await h.call('/profile')).value;
    const note = profile.signals[0];
    assert.equal(note.evidence, input.question);
    await h.call(`/signals/${note.id}`, 'PATCH', {
      assessment: 'I understand span; I need the semantic interpretation.',
    });
    await h.call(`/papers/${paper.id}/ask`, 'POST', {
      ...input,
      requestId: crypto.randomUUID(),
      action: 'quiz',
      question: 'Quiz me.',
    });
    detail = await finished(h, paper.id);
    assert.equal(detail.messages.at(-1).action, 'quiz');
    await h.call(`/papers/${paper.id}/ask`, 'POST', {
      ...input,
      requestId: crypto.randomUUID(),
      action: 'feedback',
      question: 'Yes: (0,5) equals 2.5 times (0,2).',
    });
    await finished(h, paper.id);
    await h.restart();
    detail = (await h.call(`/papers/${paper.id}`)).value;
    assert.equal(detail.messages.length, 6);
    assert.equal(detail.messages[1].quizDismissed, true);
    assert.equal(detail.recommendations[0].status, 'skipped');
    const saved = (await h.call('/profile')).value;
    assert.equal(saved.signals.find((s: any) => s.id === note.id).source, 'you');
    assert.ok(saved.signals.some((s: any) => s.confidence === 'supported'));
    const exported = (await h.call('/export')).value;
    assert.equal(exported.messages.length, 6);
    assert.equal(exported.papers.length, 1);
  } finally {
    await h.close();
  }
});
test('provider failure preserves the question and reports a recoverable failed job', async () => {
  const h = await harness(undefined, new TestProvider(10, true));
  try {
    const paper = await upload(h);
    await h.call(`/papers/${paper.id}/ask`, 'POST', {
      requestId: crypto.randomUUID(),
      action: 'chat',
      question: 'Explain this.',
      page: 1,
    });
    const detail = await finished(h, paper.id);
    assert.equal(detail.jobs[0].status, 'failed');
    assert.equal(detail.messages.length, 1);
    assert.match(detail.jobs[0].error, /unavailable/);
  } finally {
    await h.close();
  }
});
test('long-document selection explicitly labels the included context', () => {
  const paper = {
    pages: 100,
    pageTexts: Array.from({ length: 100 }, (_, i) => `Page ${i + 1}. ` + 'x'.repeat(5000)),
  } as StoredPaper;
  const context = paperContext(paper, 50);
  assert.match(context.notice, /supplied selectively/);
  assert.match(context.text, /PDF PAGE 50/);
  assert.ok(context.text.length < 165000);
  // Out-of-range pages are clamped instead of looping forever over an unbounded range.
  for (const page of [Infinity, -Infinity, NaN, 0, 9007199254740993, 1e308])
    assert.match(paperContext(paper, page).notice, /supplied selectively/, String(page));
  assert.match(paperContext(paper, 50, '', Infinity).text, /PDF PAGE 100/);
  assert.match(paperContext(paper, 50, '', 20).text, /PDF PAGE 50/);
});

test('reply style survives restart, preserves the learner profile, and reaches the provider with the selected page range', async () => {
  const h = await harness();
  try {
    const paper = await upload(h);
    const original = (await h.call('/profile')).value;
    assert.equal(original.replyLength, 'concise'); // Existing profiles receive defaults without rewriting them.
    const patch = {
      replyLength: 'balanced',
      replyInstructions: 'Use short sentences and one analogy when useful.',
    };
    assert.equal((await h.call('/profile', 'PUT', patch)).response.status, 200);
    await h.call('/profile', 'PUT', {
      background: 'I know linear algebra.',
      goals: original.goals,
      preferences: original.preferences,
    });
    assert.equal(
      (await h.call('/profile', 'PUT', { replyLength: 'invalid' })).response.status,
      400,
    );
    await h.restart();
    const profile = (await h.call('/profile')).value;
    assert.equal(profile.replyLength, 'balanced');
    assert.equal(profile.replyInstructions, patch.replyInstructions);
    assert.equal(profile.background, 'I know linear algebra.');
    assert.equal(profile.preferences, original.preferences);
    const input = {
      requestId: crypto.randomUUID(),
      action: 'explain',
      question: 'What connects these pages?',
      selection: 'End of page one.\n\nStart of page two.',
      page: 1,
      endPage: 2,
    };
    await h.call(`/papers/${paper.id}/ask`, 'POST', input);
    const detail = await finished(h, paper.id);
    assert.equal(detail.jobs[0].status, 'complete');
    for (const message of detail.messages) {
      assert.equal(message.page, 1);
      assert.equal(message.endPage, 2);
    }
    const prompt = JSON.parse(tutorPrompt(h.provider.calls[0]));
    assert.equal(prompt.responseStyle.length, 'balanced');
    assert.equal(prompt.responseStyle.instructions, patch.replyInstructions);
    assert.equal(prompt.task.endPdfPage, 2);
    assert.match(prompt.task.selectedPassage, /Start of page two/);
    assert.equal((await h.call('/export')).value.profile.replyLength, 'balanced');
    assert.equal(
      (
        await h.call(`/papers/${paper.id}/ask`, 'POST', {
          ...input,
          requestId: crypto.randomUUID(),
          page: 2,
          endPage: 1,
        })
      ).response.status,
      400,
    );
  } finally {
    await h.close();
  }
});

test('model and effort are validated, persist, and are captured when each reply is requested', async () => {
  const h = await harness(undefined, new TestProvider(120));
  try {
    const paper = await upload(h);
    const profile = (await h.call('/profile')).value;
    const initial = (await h.call('/generation')).value;
    assert.deepEqual(initial.settings, { model: 'test-model', effort: 'medium' });
    assert.equal(initial.models[1].supportsImages, false);
    const selected = { model: 'text-model', effort: 'high' };
    assert.equal((await h.call('/generation', 'PUT', selected)).response.status, 200);
    assert.equal(
      (await h.call('/generation', 'PUT', { model: 'missing', effort: 'high' })).response.status,
      400,
    );
    assert.equal(
      (await h.call('/generation', 'PUT', { model: 'text-model', effort: 'medium' })).response
        .status,
      400,
    );
    assert.deepEqual((await h.call('/profile')).value, profile);
    await h.restart();
    assert.deepEqual((await h.call('/generation')).value.settings, selected);
    const input = {
      requestId: crypto.randomUUID(),
      action: 'chat',
      question: 'Explain the direction.',
      page: 1,
    };
    await h.call(`/papers/${paper.id}/ask`, 'POST', input);
    const next = { model: 'test-model', effort: 'low' };
    await h.call('/generation', 'PUT', next);
    let detail = await finished(h, paper.id);
    assert.deepEqual(h.provider.calls[0].generation, selected);
    assert.deepEqual(detail.messages.at(-1).generation, selected);
    await h.call(`/papers/${paper.id}/ask`, 'POST', { ...input, requestId: crypto.randomUUID() });
    detail = await finished(h, paper.id);
    assert.deepEqual(h.provider.calls[1].generation, next);
    assert.deepEqual(detail.messages.at(-1).generation, next);
    assert.deepEqual((await h.call('/export')).value.generation, next);
    // A removed model stays visible in settings but is never silently replaced for generation.
    h.provider.catalog.models = h.provider.catalog.models.filter((m) => m.id !== next.model);
    assert.deepEqual((await h.call('/generation')).value.settings, next);
    assert.equal(
      (
        await h.call(`/papers/${paper.id}/ask`, 'POST', {
          ...input,
          requestId: crypto.randomUUID(),
        })
      ).response.status,
      400,
    );
    assert.equal((await h.call(`/papers/${paper.id}`)).value.messages.length, 4);
    assert.equal((await h.call('/generation', 'PUT', selected)).response.status, 200);
  } finally {
    await h.close();
  }
});

test('an out-of-range or non-numeric page query falls back to the saved position instead of hanging', async () => {
  const h = await harness();
  try {
    const paper = await upload(h);
    await h.call(`/papers/${paper.id}`, 'PATCH', { currentPage: 2 });
    for (const page of [
      'Infinity',
      '-Infinity',
      'NaN',
      'abc',
      '0',
      '3',
      '1.5',
      '9007199254740993',
    ]) {
      const started = Date.now();
      const { response, value } = await h.call(`/papers/${paper.id}?page=${page}`);
      assert.equal(response.status, 200, page);
      assert.match(value.pageText, /Checking the Idea/, page);
      assert.ok(Date.now() - started < 2000, page);
    }
    assert.match((await h.call(`/papers/${paper.id}?page=1`)).value.pageText, /Concept Directions/);
  } finally {
    await h.close();
  }
});

test('at most two tutor jobs run at once across the library, even for simultaneous requests', async () => {
  const h = await harness(undefined, new TestProvider(300));
  try {
    const papers = [await upload(h), await upload(h), await upload(h)];
    const results = await Promise.all(
      papers.map((paper) =>
        h.call(`/papers/${paper.id}/ask`, 'POST', {
          requestId: crypto.randomUUID(),
          action: 'chat',
          question: 'Explain this.',
          page: 1,
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.response.status).sort(), [202, 202, 429]);
    for (const paper of papers) await finished(h, paper.id);
    assert.equal(h.provider.calls.length, 2);
  } finally {
    await h.close();
  }
});

test('a disconnected provider is reported as a temporary failure, not a bad request', async () => {
  const provider = new TestProvider();
  provider.models = async () => {
    throw Object.assign(new Error('Codex is not connected.'), { status: 503 });
  };
  const h = await harness(undefined, provider);
  try {
    const paper = await upload(h);
    assert.equal((await h.call('/generation')).response.status, 503);
    assert.equal(
      (await h.call('/generation', 'PUT', { model: 'x', effort: 'low' })).response.status,
      503,
    );
    const ask = await h.call(`/papers/${paper.id}/ask`, 'POST', {
      requestId: crypto.randomUUID(),
      action: 'chat',
      question: 'Explain this.',
      page: 1,
    });
    assert.equal(ask.response.status, 503);
    assert.match(ask.value.error, /not connected/);
    assert.equal((await h.call(`/papers/${paper.id}`)).value.messages.length, 0);
  } finally {
    await h.close();
  }
});

test('behind the reverse proxy, login throttling keys on the forwarded client address, not a forged hop', async () => {
  const password = 'a-long-private-password';
  const h = await harness(password, new TestProvider(), 'http://127.0.0.1');
  try {
    const attempt = (ip: string, value: string) =>
      h.call('/login', 'POST', { password: value }, { 'X-Forwarded-For': ip });
    for (let i = 0; i < 8; i++)
      assert.equal((await attempt('10.0.0.1', 'wrong')).response.status, 401);
    assert.equal((await attempt('10.0.0.1', password)).response.status, 429);
    assert.equal((await attempt('10.0.0.2', password)).response.status, 200);
    // Only the address appended by the proxy counts; a client-supplied hop cannot rotate the key.
    assert.equal((await attempt('203.0.113.9, 10.0.0.1', password)).response.status, 429);
  } finally {
    await h.close();
  }
});

test('a storage failure while finishing a tutor job is logged instead of crashing the server', async () => {
  const h = await harness(undefined, new TestProvider(60));
  const log = mock.method(console, 'error', () => {});
  try {
    const paper = await upload(h);
    const ask = await h.call(`/papers/${paper.id}/ask`, 'POST', {
      requestId: crypto.randomUUID(),
      action: 'chat',
      question: 'Explain this.',
      page: 1,
    });
    assert.equal(ask.response.status, 202);
    const put = mock.method(h.store, 'put', () => {
      throw new Error('disk full');
    });
    for (let i = 0; i < 100 && log.mock.callCount() === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    put.mock.restore();
    assert.ok(log.mock.callCount() > 0, 'the failure was logged');
    assert.equal((await h.call(`/papers/${paper.id}`)).response.status, 200);
  } finally {
    log.mock.restore();
    await h.close();
  }
});

test('recovered storage persists failed jobs and releases their concurrency slots', async () => {
  const h = await harness(undefined, new TestProvider(60));
  const log = mock.method(console, 'error', () => {});
  try {
    const paper = await upload(h);
    const input = { requestId: crypto.randomUUID(), action: 'chat', question: 'Explain.', page: 1 };
    assert.equal((await h.call(`/papers/${paper.id}/ask`, 'POST', input)).response.status, 202);
    const put = mock.method(h.store, 'put', () => {
      throw new Error('disk full');
    });
    try {
      for (let i = 0; i < 100 && log.mock.callCount() === 0; i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(log.mock.callCount() > 0);
    } finally {
      put.mock.restore();
    }
    const detail = await finished(h, paper.id);
    assert.equal(detail.jobs[0].status, 'failed');
    assert.match(detail.jobs[0].error, /disk full/);
    assert.equal(detail.messages.length, 1);
    assert.equal(
      (
        await h.call(`/papers/${paper.id}/ask`, 'POST', {
          ...input,
          requestId: crypto.randomUUID(),
        })
      ).response.status,
      202,
    );
    assert.equal((await finished(h, paper.id)).jobs.at(-1).status, 'complete');
  } finally {
    log.mock.restore();
    await h.close();
  }
});

test('simultaneous request IDs cannot return another paper’s job', async () => {
  const provider = new TestProvider();
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const status = provider.status.bind(provider);
  provider.status = async () => {
    if (++requests === 2) release();
    await ready;
    return status();
  };
  const h = await harness(undefined, provider);
  try {
    const papers = [await upload(h), await upload(h)];
    const input = { requestId: crypto.randomUUID(), action: 'chat', question: 'Explain.', page: 1 };
    const results = await Promise.all(
      papers.map((paper) => h.call(`/papers/${paper.id}/ask`, 'POST', input)),
    );
    assert.deepEqual(results.map((result) => result.response.status).sort(), [202, 409]);
    for (const [index, result] of results.entries())
      if (result.response.status === 202) {
        assert.equal(result.value.paperId, papers[index].id);
        await finished(h, papers[index].id);
      }
  } finally {
    await h.close();
  }
});

test('duplicate recommendations within one answer are stored only once', async () => {
  const provider = new TestProvider();
  const answer = provider.answer.bind(provider);
  provider.answer = async (request) => {
    const result = await answer(request);
    return { ...result, recommendations: [...result.recommendations, ...result.recommendations] };
  };
  const h = await harness(undefined, provider);
  try {
    const paper = await upload(h);
    for (let i = 0; i < 2; i++) {
      await h.call(`/papers/${paper.id}/ask`, 'POST', {
        requestId: crypto.randomUUID(),
        action: 'chat',
        question: 'Explain.',
        page: 1,
      });
      assert.equal((await finished(h, paper.id)).recommendations.length, 1);
    }
  } finally {
    await h.close();
  }
});

test('password rotation invalidates existing sessions', async () => {
  const h = await harness('original-test-password');
  try {
    const login = await h.call('/login', 'POST', { password: 'original-test-password' });
    h.setCookie(login.response.headers.get('set-cookie')!.split(';')[0]);
    await h.restart('replacement-test-password');
    assert.equal((await h.call('/papers')).response.status, 401);
    const replacement = await h.call('/login', 'POST', { password: 'replacement-test-password' });
    h.setCookie(replacement.response.headers.get('set-cookie')!.split(';')[0]);
    assert.equal((await h.call('/papers')).response.status, 200);
    await h.restart();
    assert.equal((await h.call('/papers')).response.status, 200);
  } finally {
    await h.close();
  }
});

test('passwordless requests reject non-loopback hostnames', async () => {
  const h = await harness();
  const status = (host: string) =>
    new Promise<number>((resolve, reject) => {
      request(`${h.root}/papers`, { headers: { Host: host } }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      })
        .on('error', reject)
        .end();
    });
  try {
    assert.equal(await status('untrusted.example'), 403);
    assert.equal(await status('localhost'), 200);
    assert.equal(await status('[::1]'), 200);
  } finally {
    await h.close();
  }
});
