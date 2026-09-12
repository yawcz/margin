#!/usr/bin/env node
// Protocol fixture only: never used by the application.
// Accepts a turn and never completes it, to exercise Margin's tutor timeout, interrupt and archive.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  appendFileSync('calls.jsonl', JSON.stringify({ method, params }) + '\n');
  let result = {};
  if (method === 'model/list')
    result = {
      data: [
        {
          model: 'slow-model',
          displayName: 'Slow model',
          isDefault: true,
          defaultReasoningEffort: 'medium',
          supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
        },
      ],
      nextCursor: null,
    };
  if (method === 'config/read') result = { config: { model: 'slow-model' } };
  if (method === 'thread/start') result = { thread: { id: 'stalled-thread' } };
  if (method === 'turn/start') result = { turn: { id: 'turn-1' } };
  send({ id, result });
});
