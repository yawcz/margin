import express from 'express';
import multer from 'multer';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { Store, publicPaper, type StoredPaper } from './store.ts';
import { importPdf, fetchArxiv, pageImage, MAX_PDF_BYTES } from './papers.ts';
import { paperContext, resultSchema, resolveGeneration, type AgentProvider } from './tutor.ts';
import type { GenerationSettings, Job, Message, Recommendation, Signal } from '../shared/types.ts';

type Options = {
  dataDir: string;
  provider: AgentProvider;
  password?: string;
  secureCookies?: boolean;
  publicOrigin?: string;
};
const hash = (value: string) => createHash('sha256').update(value).digest();
const uuid = z.string().uuid();
export function createApp(options: Options) {
  const app = express(),
    store = new Store(options.dataDir);
  const passwordVersion = store.get<{ salt: string; digest: string }>('settings', 'password');
  const salt = passwordVersion?.salt ?? randomBytes(32).toString('hex');
  const digest = scryptSync(options.password ?? '', salt, 32).toString('hex');
  if (passwordVersion?.digest !== digest)
    store.transaction(() => {
      store.db.exec('DELETE FROM sessions');
      store.put('settings', 'password', { salt, digest });
    });
  const terminalJobs = new Map<string, Job>();
  const flushTerminalJobs = () => {
    for (const job of terminalJobs.values()) {
      try {
        store.put('jobs', job.id, job, job.paperId);
        terminalJobs.delete(job.id);
      } catch {
        break;
      }
    }
  };
  const recoveryTimer = setInterval(flushTerminalJobs, 1000);
  recoveryTimer.unref();
  app.disable('x-powered-by');
  // Behind the documented reverse proxy, identify clients by the address the proxy appended (one hop).
  if (options.publicOrigin) app.set('trust proxy', 1);
  const loginAttempts = new Map<string, { count: number; until: number }>();
  for (const job of store.list<Job>('jobs'))
    if (job.status === 'running')
      store.put(
        'jobs',
        job.id,
        {
          ...job,
          status: 'failed',
          error:
            'The server restarted before this answer finished. Your question is saved; please ask again.',
        },
        job.paperId,
      );
  app.use((req, res, next) => {
    if (!options.password && !['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) {
      res.status(403).json({ error: 'This host is not allowed for a local reader.' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const expected = options.publicOrigin || `${req.protocol}://${req.get('host')}`;
      if (req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== expected)) {
        res.status(403).json({ error: 'This request came from a different site.' });
        return;
      }
    }
    flushTerminalJobs();
    next();
  });
  const sessionValid = (req: express.Request) => {
    if (!options.password) return true;
    const token = req.headers.cookie
      ?.split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith('margin_session='))
      ?.slice(15);
    return (
      !!token &&
      !!store.db
        .prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?')
        .get(hash(token).toString('hex'), Date.now())
    );
  };
  app.get('/api/session', (req, res) =>
    res.json({ authenticated: sessionValid(req), passwordRequired: !!options.password }),
  );
  app.post('/api/login', (req, res) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    for (const [ip, entry] of loginAttempts) if (entry.until <= now) loginAttempts.delete(ip);
    const rate = loginAttempts.get(key);
    if (rate && rate.until > now && rate.count >= 8) {
      res.status(429).json({ error: 'Too many attempts. Try again in ten minutes.' });
      return;
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (options.password && !timingSafeEqual(hash(password), hash(options.password))) {
      loginAttempts.set(key, {
        count: rate && rate.until > now ? rate.count + 1 : 1,
        until: rate && rate.until > now ? rate.until : now + 600000,
      });
      res.status(401).json({ error: 'That password did not match.' });
      return;
    }
    loginAttempts.delete(key);
    const token = randomBytes(32).toString('hex');
    store.db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    store.db
      .prepare('INSERT INTO sessions(hash,expires) VALUES(?,?)')
      .run(hash(token).toString('hex'), now + 30 * 86400000);
    res.cookie('margin_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: !!options.secureCookies,
      maxAge: 30 * 86400000,
      path: '/',
    });
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => {
    if (!sessionValid(req)) {
      res.status(401).json({ error: 'Please sign in to your reader.' });
      return;
    }
    next();
  });
  app.post('/api/logout', (req, res) => {
    const token = req.headers.cookie
      ?.split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith('margin_session='))
      ?.slice(15);
    if (token)
      store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token).toString('hex'));
    res.clearCookie('margin_session', { path: '/' }).json({ ok: true });
  });
  app.get('/api/agent', async (_req, res) => res.json(await options.provider.status()));
  const generationSettings = async () =>
    resolveGeneration(
      await options.provider.models(),
      store.get<GenerationSettings>('settings', 'generation'),
    );
  app.get('/api/generation', async (_req, res) => {
    const catalog = await options.provider.models();
    // Keep saved but unavailable selections visible so the reader can correct them.
    const settings = store.get<GenerationSettings>('settings', 'generation') ?? {
      model: catalog.defaultModel,
      effort: catalog.models
        .find((m) => m.id === catalog.defaultModel)
        ?.efforts.some((e) => e.id === 'medium')
        ? 'medium'
        : (catalog.models.find((m) => m.id === catalog.defaultModel)?.defaultEffort ?? ''),
    };
    res.json({ ...catalog, settings });
  });
  app.put('/api/generation', async (req, res) => {
    const input = z
      .object({ model: z.string().min(1).max(200), effort: z.string().min(1).max(40) })
      .parse(req.body);
    const settings = resolveGeneration(await options.provider.models(), input);
    store.put('settings', 'generation', settings);
    res.json(settings);
  });
  app.get('/api/papers', (_req, res) =>
    res.json(
      store
        .list<StoredPaper>('papers')
        .map(publicPaper)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_BYTES, files: 1 },
  });
  app.post('/api/papers', upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Choose a PDF to upload.' });
      return;
    }
    const paper = await importPdf(store, req.file.buffer, req.file.originalname);
    res.status(201).json(publicPaper(paper));
  });
  app.post('/api/import', async (req, res) => {
    const { url } = z.object({ url: z.string().max(250) }).parse(req.body);
    const result = await fetchArxiv(url);
    const paper = await importPdf(
      store,
      result.buffer,
      result.id + '.pdf',
      `https://arxiv.org/abs/${result.id}`,
    );
    res.status(201).json(publicPaper(paper));
  });
  const getPaper = (id: string) => {
    const paper = store.get<StoredPaper>('papers', uuid.parse(id));
    if (!paper) throw Object.assign(new Error('Paper not found.'), { status: 404 });
    return paper;
  };
  app.get('/api/papers/:id', (req, res) => {
    const paper = getPaper(req.params.id);
    const requested = Number(req.query.page);
    const page =
      Number.isInteger(requested) && requested >= 1 && requested <= paper.pages
        ? requested
        : paper.currentPage;
    res.json({
      paper: publicPaper(paper),
      messages: store.list<Message>('messages', paper.id),
      recommendations: store
        .list<Recommendation>('recommendations', paper.id)
        .sort((a, b) => a.position - b.position),
      pageText: paper.pageTexts[page - 1] || '',
      contextNotice: paperContext(paper, page).notice,
      jobs: store.list<Job>('jobs', paper.id).slice(-5),
    });
  });
  app.get('/api/papers/:id/pdf', (req, res) => {
    const paper = getPaper(req.params.id);
    res.setHeader('Content-Disposition', 'inline');
    res.type('application/pdf').sendFile(join(store.dir, 'papers', paper.id + '.pdf'));
  });
  app.patch('/api/papers/:id', (req, res) => {
    const paper = getPaper(req.params.id);
    const patch = z
      .object({
        title: z.string().trim().min(1).max(300).optional(),
        currentPage: z.number().int().min(1).max(paper.pages).optional(),
        status: z.enum(['reading', 'queued', 'read']).optional(),
      })
      .parse(req.body);
    Object.assign(paper, patch, { updatedAt: new Date().toISOString() });
    store.put('papers', paper.id, paper);
    res.json(publicPaper(paper));
  });
  app.get('/api/profile', (_req, res) => res.json(store.profile()));
  app.put('/api/profile', (req, res) => {
    const profile = z
      .object({
        background: z.string().max(12000).optional(),
        goals: z.string().max(8000).optional(),
        preferences: z.string().max(8000).optional(),
        replyLength: z.enum(['concise', 'balanced', 'detailed']).optional(),
        replyInstructions: z.string().max(2000).optional(),
      })
      .parse(req.body);
    const { signals: _signals, ...saved } = store.profile();
    store.put('settings', 'profile', { ...saved, ...profile });
    res.json(store.profile());
  });
  app.patch('/api/signals/:id', (req, res) => {
    const signal = store.get<Signal>('signals', uuid.parse(req.params.id));
    if (!signal) {
      res.status(404).json({ error: 'Learning note not found.' });
      return;
    }
    const { assessment } = z
      .object({ assessment: z.string().trim().min(1).max(800) })
      .parse(req.body);
    store.put(
      'signals',
      signal.id,
      { ...signal, assessment, source: 'you', confidence: 'supported' },
      signal.paperId,
    );
    res.json({ ok: true });
  });
  app.delete('/api/signals/:id', (req, res) => {
    store.remove('signals', uuid.parse(req.params.id));
    res.json({ ok: true });
  });
  app.patch('/api/recommendations/:id', (req, res) => {
    const rec = store.get<Recommendation>('recommendations', uuid.parse(req.params.id));
    if (!rec) {
      res.status(404).json({ error: 'Recommendation not found.' });
      return;
    }
    const patch = z
      .object({
        status: z.enum(['suggested', 'queued', 'skipped', 'read']).optional(),
        position: z.number().int().min(0).max(10000).optional(),
      })
      .parse(req.body);
    store.put('recommendations', rec.id, { ...rec, ...patch }, rec.paperId);
    res.json({ ...rec, ...patch });
  });
  app.patch('/api/messages/:id', (req, res) => {
    const message = store.get<Message>('messages', uuid.parse(req.params.id));
    if (!message) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    const patch = z.object({ quizDismissed: z.boolean() }).parse(req.body);
    store.put('messages', message.id, { ...message, ...patch }, message.paperId);
    res.json({ ok: true });
  });
  app.get('/api/export', (_req, res) =>
    res.attachment('margin-learning-history.json').json({
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: store.profile(),
      generation: store.get<GenerationSettings>('settings', 'generation') ?? null,
      papers: store.list<StoredPaper>('papers').map(publicPaper),
      messages: store.list('messages'),
      recommendations: store.list('recommendations'),
    }),
  );
  app.post('/api/papers/:id/ask', async (req, res) => {
    const paper = getPaper(req.params.id);
    const input = z
      .object({
        requestId: uuid,
        action: z.enum([
          'explain',
          'chat',
          'orientation',
          'prerequisites',
          'next',
          'quiz',
          'feedback',
        ]),
        question: z.string().trim().min(1).max(12000),
        selection: z.string().max(18000).default(''),
        page: z.number().int().min(1).max(paper.pages),
        endPage: z.number().int().min(1).max(paper.pages).optional(),
      })
      .refine((value) => (value.endPage ?? value.page) >= value.page, {
        message: 'The selected page range must be in reading order.',
        path: ['endPage'],
      })
      .parse(req.body);
    const existing = store.get<Job>('jobs', input.requestId);
    if (existing) {
      if (existing.paperId !== paper.id) {
        res.status(409).json({ error: 'That request identifier is already in use.' });
        return;
      }
      res.json(existing);
      return;
    }
    const busyReason = () => {
      if (store.list<Job>('jobs', paper.id).some((j) => j.status === 'running'))
        return { status: 409, error: 'The tutor is still answering your previous question.' };
      if (store.list<Job>('jobs').filter((j) => j.status === 'running').length >= 2)
        return {
          status: 429,
          error: 'The tutor is busy with two other questions. Try again shortly.',
        };
      return undefined;
    };
    let busy = busyReason();
    if (busy) {
      res.status(busy.status).json({ error: busy.error });
      return;
    }
    const status = await options.provider.status();
    if (!status.authenticated) {
      res.status(503).json({ error: status.detail });
      return;
    }
    const generation = await generationSettings();
    // Recheck after asynchronous auth discovery, to avoid concurrent double submissions.
    const duplicate = store.get<Job>('jobs', input.requestId);
    if (duplicate) {
      if (duplicate.paperId !== paper.id) {
        res.status(409).json({ error: 'That request identifier is already in use.' });
        return;
      }
      res.json(duplicate);
      return;
    }
    busy = busyReason();
    if (busy) {
      res.status(busy.status).json({ error: busy.error });
      return;
    }
    const now = new Date().toISOString();
    const job: Job = {
      id: input.requestId,
      paperId: paper.id,
      status: 'running',
      error: '',
      createdAt: now,
    };
    const message: Message = {
      id: randomUUID(),
      paperId: paper.id,
      role: 'user',
      content: input.question,
      action: input.action,
      page: input.page,
      endPage: input.endPage ?? input.page,
      selection: input.selection,
      createdAt: now,
      quizSuggested: false,
      quizDismissed: false,
      quizReason: '',
    };
    const history = store.list<Message>('messages', paper.id);
    store.transaction(() => {
      store.put('jobs', job.id, job, paper.id);
      store.put('messages', message.id, message, paper.id);
    });
    res.status(202).json(job);
    (async () => {
      try {
        const imagePath = await pageImage(store, paper, input.page);
        const result = resultSchema.parse(
          await options.provider.answer({
            paper,
            library: store.list<StoredPaper>('papers').map(publicPaper),
            readingPath: store.list<Recommendation>('recommendations'),
            profile: store.profile(),
            messages: history,
            action: input.action,
            question: input.question,
            selection: input.selection,
            page: input.page,
            endPage: input.endPage ?? input.page,
            imagePath,
            generation,
          }),
        );
        const reply: Message = {
          ...message,
          id: randomUUID(),
          role: 'assistant',
          generation,
          content: result.answer,
          quizSuggested: result.quizSuggested,
          quizReason: result.quizReason,
          createdAt: new Date().toISOString(),
        };
        store.transaction(() => {
          store.put('messages', reply.id, reply, paper.id);
          for (const signal of result.signals) {
            const id = randomUUID();
            store.put(
              'signals',
              id,
              {
                ...signal,
                id,
                paperId: paper.id,
                messageId: message.id,
                createdAt: reply.createdAt,
                source: 'tutor',
              },
              paper.id,
            );
          }
          const old = store.list<Recommendation>('recommendations', paper.id);
          const seenUrls = new Set(old.map((recommendation) => recommendation.url));
          let position = old.length;
          for (const recommendation of result.recommendations) {
            let parsed: URL;
            try {
              parsed = new URL(recommendation.url);
            } catch {
              continue;
            }
            if (!['https:', 'http:'].includes(parsed.protocol) || seenUrls.has(recommendation.url))
              continue;
            seenUrls.add(recommendation.url);
            const id = randomUUID();
            store.put(
              'recommendations',
              id,
              {
                ...recommendation,
                id,
                paperId: paper.id,
                status: 'suggested',
                position: position++,
              },
              paper.id,
            );
          }
          store.put(
            'jobs',
            job.id,
            { ...job, status: 'complete', finishedAt: reply.createdAt },
            paper.id,
          );
        });
      } catch (error) {
        const failed: Job = {
          ...job,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error:
            error instanceof Error
              ? error.message
              : 'The tutor could not finish. Please try again.',
        };
        try {
          store.put('jobs', job.id, failed, paper.id);
        } catch (writeError) {
          terminalJobs.set(job.id, failed);
          console.error('[margin] Could not record a failed tutor job', writeError);
        }
      }
    })().catch((error) => console.error('[margin] Tutor job failed unexpectedly', error));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'That endpoint does not exist.' }));
  app.use(
    (error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message || 'Invalid request.' });
        return;
      }
      if (error instanceof multer.MulterError) {
        res.status(400).json({
          error:
            error.code === 'LIMIT_FILE_SIZE'
              ? 'This PDF is larger than the 30 MB limit.'
              : 'Please upload one PDF file.',
        });
        return;
      }
      const safe =
        error.message && !error.message.includes('Command failed')
          ? error.message
          : 'The server could not read this PDF. Try another copy.';
      res.status(error.status || 400).json({ error: safe });
    },
  );
  return {
    app,
    store,
    close: () => {
      clearInterval(recoveryTimer);
      flushTerminalJobs();
      options.provider.close();
      store.close();
    },
  };
}
