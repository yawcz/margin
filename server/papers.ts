import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store, StoredPaper } from './store.ts';
const exec = promisify(execFile);
export const MAX_PDF_BYTES = 30 * 1024 * 1024;
export async function importPdf(
  store: Store,
  buffer: Buffer,
  filename: string,
  source = '',
  title = '',
): Promise<StoredPaper> {
  if (buffer.length > MAX_PDF_BYTES) throw new Error('This PDF is larger than the 30 MB limit.');
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')))
    throw new Error('Please choose a PDF file.');
  const id = randomUUID(),
    path = join(store.dir, 'papers', id + '.pdf');
  await writeFile(path, buffer, { mode: 0o600 });
  try {
    const { stdout } = await exec('pdftotext', ['-layout', path, '-'], {
      maxBuffer: 12 * 1024 * 1024,
      timeout: 30000,
    });
    const pageTexts = stdout.split('\f');
    if (!pageTexts.at(-1)?.trim()) pageTexts.pop();
    if (!pageTexts.length || pageTexts.length > 500)
      throw new Error('Please use a PDF with 1–500 pages.');
    if (pageTexts.join('').trim().length < 40)
      throw new Error('This PDF has no usable text layer. Scanned PDFs need OCR before importing.');
    let metadata = '';
    try {
      metadata = (await exec('pdfinfo', [path], { timeout: 5000 })).stdout;
    } catch {}
    const metaTitle = metadata.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
    const fallback = pageTexts[0]
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s.length > 20 && !/arxiv:|preprint|submitted|published/i.test(s));
    const now = new Date().toISOString();
    const paper: StoredPaper = {
      id,
      title: (title || metaTitle || fallback || filename.replace(/\.pdf$/i, '')).slice(0, 300),
      filename: filename.slice(0, 250),
      source,
      pages: pageTexts.length,
      pageTexts,
      currentPage: 1,
      status: 'reading',
      createdAt: now,
      updatedAt: now,
    };
    store.put('papers', id, paper);
    return paper;
  } catch (e) {
    await unlink(path).catch(() => {});
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('PDF tools are missing on the server. Install poppler-utils.');
    throw e;
  }
}
export async function pageImage(
  store: Store,
  paper: StoredPaper,
  page: number,
): Promise<string | undefined> {
  const prefix = join(store.dir, 'pages', `${paper.id}-${page}`),
    path = prefix + '.png';
  try {
    await access(path);
    return path;
  } catch {}
  try {
    await exec(
      'pdftoppm',
      [
        '-f',
        String(page),
        '-l',
        String(page),
        '-singlefile',
        '-scale-to',
        '1400',
        '-png',
        join(store.dir, 'papers', paper.id + '.pdf'),
        prefix,
      ],
      { timeout: 25000, maxBuffer: 1024 * 1024 },
    );
    return path;
  } catch {
    return undefined;
  }
}
export async function fetchArxiv(input: string): Promise<{ buffer: Buffer; id: string }> {
  const raw = input.trim();
  const match = raw.match(
    /^(?:https:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/)?(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?\/?$/,
  );
  if (!match) throw new Error('Enter an arXiv identifier or arxiv.org paper link.');
  const id = match[1];
  const response = await fetch(`https://arxiv.org/pdf/${id}`, {
    signal: AbortSignal.timeout(45000),
    redirect: 'error',
  });
  if (!response.ok || !response.body)
    throw new Error('arXiv could not provide that PDF. You can upload a downloaded copy instead.');
  const chunks: Buffer[] = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_PDF_BYTES) {
        await reader.cancel();
        throw new Error('This PDF is larger than the 30 MB limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return { buffer: Buffer.concat(chunks), id };
}
