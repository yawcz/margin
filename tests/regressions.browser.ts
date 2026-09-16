import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { samplePdf, multilingualPdf } from './fixtures';
import type { Paper, PaperDetail, Job, Profile } from '../shared/types';

type Detail = PaperDetail & { jobs: Job[] };
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function upload(request: APIRequestContext, buffer = samplePdf()): Promise<Paper> {
  const response = await request.post('/api/papers', {
    multipart: { file: { name: 'regression.pdf', mimeType: 'application/pdf', buffer } },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function open(page: Page, paper: Paper) {
  await page.goto('/');
  await page
    .locator('.paper-card')
    .filter({ has: page.getByRole('heading', { name: paper.title, exact: true }) })
    .first()
    .click();
  await expect(page.getByLabel('Ask the tutor', { exact: true })).toBeAttached();
}
async function answer(request: APIRequestContext, paper: Paper) {
  const response = await request.post(`/api/papers/${paper.id}/ask`, {
    data: {
      requestId: crypto.randomUUID(),
      action: 'chat',
      question: 'Explain the direction.',
      page: 1,
    },
  });
  expect(response.status()).toBe(202);
  await expect
    .poll(async () => {
      const detail: Detail = await (await request.get(`/api/papers/${paper.id}`)).json();
      return detail.jobs.at(-1)?.status;
    })
    .toBe('complete');
}

test('selected PDF lines keep their word boundaries', async ({ page, request }) => {
  const paper = await upload(request);
  await open(page, paper);
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await page
    .locator('.textLayer')
    .first()
    .evaluate((layer) => {
      const spans = Array.from(layer.querySelectorAll('span'));
      const start = spans.find((span) => span.textContent?.includes('shared direction'))!;
      const end = spans.find((span) => span.textContent?.includes('nonzero difference'))!;
      const range = document.createRange();
      range.setStart(start.firstChild!, 2);
      range.setEnd(end.firstChild!, end.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
  const sent = page.waitForRequest((req) => req.url().endsWith('/ask'));
  await page.getByRole('button', { name: 'Explain selection' }).click();
  const input: { selection: string } = (await sent).postDataJSON();
  expect(input.selection).toBe(
    'concept can be represented by a shared direction.\nThe subspace is the span of a nonzero difference vector.',
  );
});

test('CMap-backed PDFs retain multilingual selectable text', async ({ page, request }) => {
  const paper = await upload(request, multilingualPdf());
  await open(page, paper);
  await expect(page.locator('.textLayer')).toContainText('日本語');
  for (const asset of [
    'cmaps/Adobe-Japan1-UCS2.bcmap',
    'standard_fonts/LiberationSans-Regular.ttf',
    'wasm/openjpeg.wasm',
  ])
    expect((await request.get(`/pdfjs/${asset}`)).status()).toBe(200);
});

test.describe('state recovery', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop', 'Shared state handlers are checked once.');
  });

  test('drafts survive navigation and delayed failures preserve the newer draft', async ({
    page,
    request,
  }) => {
    const paper = await upload(request);
    await open(page, paper);
    const composer = page.getByLabel('Ask the tutor', { exact: true });
    await composer.fill('The first draft.');
    await page.getByRole('button', { name: 'Learning profile' }).click();
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.locator('.paper-card').first().click();
    await expect(composer).toHaveValue('The first draft.');
    const sent = gate();
    const release = gate();
    await page.route('**/api/papers/*/ask', async (route) => {
      sent.release();
      await release.promise;
      await route.fulfill({ status: 503, json: { error: 'Delayed rejection' } });
    });
    await page.getByRole('button', { name: 'Send question' }).click();
    await sent.promise;
    await composer.fill('A newer draft.');
    release.release();
    await expect(page.getByRole('alert')).toContainText('Delayed rejection');
    await expect(composer).toHaveValue('A newer draft.');
    await page.getByText('Unsent question', { exact: true }).click();
    await expect(page.locator('.composer-area details')).toContainText('The first draft.');
    await page.getByRole('button', { name: 'Restore unsent question' }).click();
    await expect(composer).toHaveValue('The first draft.\n\nA newer draft.');
  });

  test('an accepted question stays accepted when its detail refresh fails', async ({
    page,
    request,
  }) => {
    const paper = await upload(request);
    await open(page, paper);
    await page.route(`**/api/papers/${paper.id}?*`, (route) =>
      route.fulfill({ status: 503, json: { error: 'Refresh unavailable' } }),
    );
    const composer = page.getByLabel('Ask the tutor', { exact: true });
    await composer.fill('Only send this once.');
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(composer).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Send question' })).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.unroute(`**/api/papers/${paper.id}?*`);
    await expect(page.locator('.message.assistant')).toHaveCount(1);
    const detail: Detail = await (await request.get(`/api/papers/${paper.id}`)).json();
    expect(detail.messages.filter((message) => message.role === 'user')).toHaveLength(1);
  });

  test('late refreshes cannot replace a newer conversation', async ({ page, request }) => {
    const paper = await upload(request);
    await open(page, paper);
    const captured = gate();
    const release = gate();
    let calls = 0;
    await page.route(`**/api/papers/${paper.id}?*`, async (route) => {
      const response = await route.fetch();
      if (++calls === 1) {
        captured.release();
        await release.promise;
      }
      await route.fulfill({ response });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await captured.promise;
    await answer(request, paper);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.message.assistant')).toHaveCount(1);
    release.release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(page.locator('.message.assistant')).toHaveCount(1);
  });

  test('editing learning notes preserves the unsaved profile', async ({ page, request }) => {
    const paper = await upload(request);
    await answer(request, paper);
    await page.goto('/');
    await page.getByRole('button', { name: 'Learning profile' }).click();
    await page.getByLabel('Your background').fill('Unsaved background');
    await page.getByLabel('What you want to learn').fill('Unsaved goals');
    await page.getByLabel('How you like to learn').fill('Unsaved preferences');
    await page
      .getByRole('button', { name: 'Correct Concept directions', exact: true })
      .first()
      .click();
    await page.getByLabel('Assessment for Concept directions').fill('Corrected assessment');
    await page.getByRole('button', { name: 'Save correction' }).click();
    await expect(page.getByText('Corrected assessment', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Your background')).toHaveValue('Unsaved background');
    await page
      .getByRole('button', { name: 'Remove Concept directions', exact: true })
      .first()
      .click();
    await expect(page.getByText('Corrected assessment', { exact: true })).toBeHidden();
    await expect(page.getByLabel('What you want to learn')).toHaveValue('Unsaved goals');
    await expect(page.getByLabel('How you like to learn')).toHaveValue('Unsaved preferences');
  });

  test('reply style cannot overwrite saved settings after a failed initial load', async ({
    page,
    request,
  }) => {
    const paper = await upload(request);
    const profile: Profile = await (await request.get('/api/profile')).json();
    await page.route('**/api/profile', (route) =>
      route.fulfill({ status: 503, json: { error: 'Profile unavailable' } }),
    );
    await open(page, paper);
    await page.getByRole('button', { name: /Reply style:/ }).click();
    await expect(page.getByRole('button', { name: 'Save reply style' })).toBeDisabled();
    await page.unroute('**/api/profile');
    await page.getByRole('button', { name: 'Retry reply style' }).click();
    await expect(page.getByLabel('Writing instructions')).toHaveValue(profile.replyInstructions);
    await expect(page.getByLabel('Answer length')).toHaveValue(profile.replyLength);
    await expect(page.getByRole('button', { name: 'Save reply style' })).toBeEnabled();
  });

  test('reading-path failures are visible in the reading-path tab', async ({ page, request }) => {
    const paper = await upload(request);
    await answer(request, paper);
    await open(page, paper);
    await page.route('**/api/recommendations/*', (route) =>
      route.fulfill({ status: 503, json: { error: 'Recommendation could not be saved' } }),
    );
    await page.getByRole('button', { name: /Reading path/ }).click();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Recommendation could not be saved');
  });

  test('the import dialog traps focus, closes with Escape, and restores focus', async ({
    page,
  }) => {
    await page.goto('/');
    const opener = page.getByRole('button', { name: 'Add a paper', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty('open', true);
    await opener.evaluate((node) => node.focus());
    await expect(dialog.getByRole('textbox')).toBeFocused();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() =>
          dialog.evaluate((node) => node.contains(document.activeElement) || !document.hasFocus()),
        )
        .toBe(true);
    }
    await dialog.getByRole('textbox').focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
