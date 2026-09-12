import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Paper, Profile, Signal } from '../shared/types.ts';
import { defaultReplyStyle } from '../shared/types.ts';

export type StoredPaper = Paper & { pageTexts: string[] };
export class Store {
  db: DatabaseSync;
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const sub of ['papers', 'pages', 'agent-workspace'])
      mkdirSync(join(dir, sub), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'margin.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, paper_id TEXT NOT NULL DEFAULT '', data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS by_paper ON records(kind,paper_id);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);
    if (!this.get('settings', 'profile'))
      this.put('settings', 'profile', {
        background:
          'I am relatively new to machine learning, interpretability, and alignment. I have implemented a transformer from scratch and used interpretability tooling to detect induction heads.',
        goals:
          'Understand ML papers deeply enough to eventually reproduce them. For pure mathematics, develop intuition and test it with personalized questions.',
        preferences:
          'Connect unfamiliar ideas to things I already know. Explain omitted reasoning, use toy examples and formal definitions. Suggest quizzes after challenging sections. Let me override prerequisite detours.',
      });
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id) as
      { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  list<T>(kind: string, paperId?: string): T[] {
    const rows =
      paperId === undefined
        ? this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind)
        : this.db
            .prepare('SELECT data FROM records WHERE kind=? AND paper_id=? ORDER BY rowid')
            .all(kind, paperId);
    return rows.map((row) => JSON.parse(row.data as string) as T);
  }
  put(kind: string, id: string, value: unknown, paperId = '') {
    this.db
      .prepare(
        'INSERT INTO records(kind,id,paper_id,data) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,paper_id=excluded.paper_id',
      )
      .run(kind, id, paperId, JSON.stringify(value));
  }
  remove(kind: string, id: string) {
    this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  profile(): Profile {
    return {
      ...defaultReplyStyle,
      ...this.get<Omit<Profile, 'signals'>>('settings', 'profile')!,
      signals: this.list<Signal>('signals').reverse(),
    };
  }
  close() {
    this.db.close();
  }
}
export function publicPaper(paper: StoredPaper): Paper {
  const { pageTexts: _texts, ...result } = paper;
  return result;
}
