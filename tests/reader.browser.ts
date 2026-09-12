import { test, expect } from '@playwright/test';
import { samplePdf } from './fixtures';
test('upload, select a passage, follow up, quiz, navigate and resume', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a paper', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'concept-directions.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf(),
  });
  await expect(page.locator('.reader-title h1')).toHaveText(
    'A Small Paper About Concept Directions',
  );
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await page
    .locator('.textLayer')
    .first()
    .evaluate((layer) => {
      const span = Array.from(layer.querySelectorAll('span')).find((s) =>
        s.textContent?.includes('shared direction'),
      )!;
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
  await expect(page.getByRole('button', { name: 'Explain selection' })).toBeVisible();
  // Hold the request briefly so the busy state of the selection bar is observable.
  await page.route(
    '**/api/papers/*/ask',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Explain selection' }).click();
  // On phones the paper panel is hidden as soon as the question is sent; the button still exists.
  await expect(
    page.getByRole('button', { name: 'Answering…', includeHidden: true }),
  ).toBeDisabled();
  await expect(page.locator('.message.assistant')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('.message.assistant')).toContainText('one-dimensional subspace');
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.getByRole('button', { name: 'Try a quick quiz' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  await page
    .getByRole('textbox', { name: 'Ask the tutor' })
    .fill('Yes, because (0,5) is 2.5 times (0,2).');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(3);
  await page.getByRole('button', { name: /Reading path/ }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.locator('.recommendation')).toHaveClass(/skipped/);
  if (info.project.name !== 'desktop')
    await page.locator('.mobile-reader-nav').getByRole('button', { name: /Paper/ }).click();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('2');
  await expect
    .poll(async () => {
      const papers = await (await page.request.get('/api/papers')).json();
      return papers.some((p: any) => p.currentPage === 2);
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.locator('.paper-card').first().click();
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('2');
  if (info.project.name !== 'desktop')
    await page.locator('.mobile-reader-nav').getByRole('button', { name: /Tutor/ }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(3);
  await expect
    .poll(() =>
      page.locator('.conversation').evaluate((panel) => {
        const bounds = panel.getBoundingClientRect();
        const latest = panel.querySelector('.message:last-of-type')!.getBoundingClientRect();
        return latest.top < bounds.bottom && latest.bottom > bounds.top;
      }),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await expect(page.locator('.pdf-loading')).toBeHidden();
  await page.screenshot({ path: `test-results/${info.project.name}-reader.png`, fullPage: true });
  await page.getByRole('button', { name: 'Learning profile' }).click();
  await expect(
    page.getByText('Explained membership using scalar multiplication.').first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('a rejected request keeps the typed question in the composer', async ({ page }, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'The shared composer request handler only needs one failure-path check.',
  );
  await page.goto('/');
  await page.locator('.paper-card').first().click();
  await page.route(
    '**/api/papers/*/ask',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'The tutor is temporarily unavailable.' }),
      }),
    { times: 1 },
  );
  await page
    .getByRole('textbox', { name: 'Ask the tutor' })
    .fill('Please keep this question if the connection fails.');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('textbox', { name: 'Ask the tutor' })).toHaveValue(
    'Please keep this question if the connection fails.',
  );
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByRole('alert')).toHaveCount(1);
});

test('cross-page highlights keep their source range; reply styles persist and long answers expand', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a paper', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: `continuous-${info.project.name}.pdf`,
    mimeType: 'application/pdf',
    buffer: samplePdf(),
  });
  const first = page.locator('[data-page-number="1"]');
  const second = page.locator('[data-page-number="2"]');
  await expect(first.locator('.textLayer span').first()).toBeVisible();
  await page.locator('.pdf-scroll').evaluate((root) => {
    const first = root.querySelector<HTMLElement>('[data-page-number="1"]')!;
    root.scrollTop = first.offsetTop + first.offsetHeight - 170;
  });
  await expect(second.locator('.textLayer span').first()).toBeVisible();
  if (info.project.name === 'desktop') {
    const start = await first
      .locator('.textLayer span')
      .filter({ hasText: 'This argument continues' })
      .boundingBox();
    const end = await second.locator('.textLayer span').first().boundingBox();
    await page.mouse.move(start!.x + 1, start!.y + start!.height / 2);
    await page.mouse.down();
    await page.mouse.move(end!.x + end!.width - 1, end!.y + end!.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect(page.locator('.selection-bar')).toContainText('pp. 1–2');
  }
  // A backwards selection must produce the same ordered range on every layout.
  await page.locator('.pdfViewer').evaluate((viewer) => {
    const start = Array.from(
      viewer.querySelectorAll('[data-page-number="1"] .textLayer span'),
    ).find((span) => span.textContent?.includes('This argument continues'))!.firstChild!;
    const end = viewer.querySelector('[data-page-number="2"] .textLayer span')!.firstChild!;
    window.getSelection()!.setBaseAndExtent(end, end.textContent!.length, start, 0);
  });
  await expect(page.locator('.selection-bar')).toContainText('pp. 1–2');
  await page.locator('.pdf-scroll').evaluate((root) => {
    root.scrollTop = root.querySelector<HTMLElement>('[data-page-number="2"]')!.offsetTop;
  });
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('2');
  const request = page.waitForRequest(
    (req) => req.url().endsWith('/ask') && req.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Explain selection' }).click();
  const input = (await request).postDataJSON();
  expect(input.page).toBe(1);
  expect(input.endPage).toBe(2);
  expect(input.selection).toContain('This argument continues');
  expect(input.selection).toContain('Checking the Idea');
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect(page.locator('.message.user .message-label')).toContainText('pp. 1–2');
  await page.getByRole('button', { name: /Reply style/ }).click();
  await page.getByLabel('Answer length').selectOption('concise');
  await page.getByLabel('Writing instructions').fill('Use short, natural sentences. No preamble.');
  await page.getByRole('button', { name: 'Save reply style' }).click();
  await expect(page.getByRole('button', { name: /Reply style/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page
    .getByRole('textbox', { name: 'Ask the tutor' })
    .fill('Show a long explanation for the reader test.');
  await page.getByRole('button', { name: 'Send question' }).click();
  const answer = page.locator('.message.assistant').last();
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  await expect(answer.getByRole('button', { name: 'Show full answer' })).toBeVisible();
  expect(
    await answer.locator('.answer-body').evaluate((node) => node.clientHeight),
  ).toBeLessThanOrEqual(256);
  await answer.getByRole('button', { name: 'Show full answer' }).click();
  await expect(answer.getByRole('button', { name: 'Show less' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(
    await answer.locator('.answer-body').evaluate((node) => node.clientHeight),
  ).toBeGreaterThan(256);
  await answer.getByRole('button', { name: 'Show less' }).click();
  // Keyboard focus must reveal a citation that was below the folded preview.
  await answer.getByRole('button', { name: 'p. 2', exact: true }).last().focus();
  await expect(answer.getByRole('button', { name: 'Show less' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await answer.getByRole('button', { name: 'Show less' }).click();
  const deeper = page.waitForRequest(
    (req) => req.url().endsWith('/ask') && req.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Go deeper', exact: true }).click();
  expect((await deeper).postDataJSON().endPage).toBe(2);
  await expect(page.locator('.message.assistant')).toHaveCount(3);
  await page.reload();
  await page.locator('.paper-card').first().click();
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('2');
  if (info.project.name !== 'desktop')
    await page.locator('.mobile-reader-nav').getByRole('button', { name: /Tutor/ }).click();
  await page.getByRole('button', { name: /Reply style/ }).click();
  await expect(page.getByLabel('Writing instructions')).toHaveValue(
    'Use short, natural sentences. No preamble.',
  );
  await expect(page.getByLabel('Answer length')).toHaveValue('concise');
  await page.getByRole('button', { name: /Reply style/ }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.screenshot({
    path: `test-results/${info.project.name}-continuous-reader.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('model and effort controls persist and label the model used for new replies', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a paper', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: `model-controls-${info.project.name}.pdf`,
    mimeType: 'application/pdf',
    buffer: samplePdf(),
  });
  if (info.project.name !== 'desktop')
    await page.locator('.mobile-reader-nav').getByRole('button', { name: /Tutor/ }).click();
  const toggle = page.getByRole('button', { name: /Model and effort/ });
  await toggle.click();
  await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('test-model');
  await page
    .getByRole('combobox', { name: 'Reasoning effort', exact: true })
    .selectOption('medium');
  await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('text-model');
  await expect(page.getByRole('combobox', { name: 'Reasoning effort', exact: true })).toHaveValue(
    'low',
  );
  await expect(
    page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).locator('option'),
  ).toHaveCount(2);
  await expect(
    page.getByText('This model uses the paper’s extracted text. Page images are unavailable.'),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).selectOption('high');
  await page.getByRole('button', { name: 'Save model settings' }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('Text model · High');
  await page
    .getByRole('textbox', { name: 'Ask the tutor' })
    .fill('How does the shared direction work?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('.message.assistant .message-generation')).toHaveText(
    'text-model · high',
  );
  await page.reload();
  await page.locator('.paper-card').first().click();
  if (info.project.name !== 'desktop')
    await page.locator('.mobile-reader-nav').getByRole('button', { name: /Tutor/ }).click();
  await expect(toggle).toContainText('Text model · High');
  await toggle.click();
  await expect(page.getByRole('combobox', { name: 'Reasoning effort', exact: true })).toHaveValue(
    'high',
  );
  // Opening Reply style closes model controls and still saves independently.
  await page.getByRole('button', { name: /Reply style/ }).click();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeHidden();
  await page.getByLabel('Answer length').selectOption('concise');
  await page.getByRole('button', { name: 'Save reply style' }).click();
  await expect(toggle).toContainText('Text model · High');
  // A rejected save must keep the effective model visible and the draft editable.
  await page.route('**/api/generation', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Model settings could not be saved.' }),
        })
      : route.continue(),
  );
  await toggle.click();
  await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('test-model');
  await page.getByRole('button', { name: 'Save model settings' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  await expect(toggle).toContainText('Text model · High');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue(
    'test-model',
  );
  await toggle.click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.screenshot({
    path: `test-results/${info.project.name}-model-controls.png`,
    fullPage: true,
  });
});
