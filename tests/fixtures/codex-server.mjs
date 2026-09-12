#!/usr/bin/env node
// Protocol fixture only: never used by the application.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  appendFileSync('calls.jsonl', JSON.stringify({ method, params }) + '\n');
  let result = {};
  if (method === 'model/list')
    result = params.cursor
      ? {
          data: [
            {
              model: 'text-model',
              displayName: 'Text model',
              defaultReasoningEffort: 'low',
              supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Quick' }],
              inputModalities: ['text'],
            },
          ],
          nextCursor: null,
        }
      : {
          data: [
            {
              model: 'image-model',
              displayName: 'Image model',
              isDefault: true,
              defaultReasoningEffort: 'medium',
              supportedReasoningEfforts: [
                { reasoningEffort: 'medium', description: 'Balanced' },
                { reasoningEffort: 'high', description: 'Thorough' },
              ],
            },
          ],
          nextCursor: 'page-2',
        };
  if (method === 'config/read')
    result = {
      config: { model: 'image-model', unrelatedPrivateSetting: 'test-only-private-value' },
    };
  if (method === 'thread/start') result = { thread: { id: 'test-thread' }, model: params.model };
  send({ id, result });
  if (method === 'turn/start')
    setTimeout(() => {
      send({
        method: 'item/completed',
        params: {
          threadId: 'test-thread',
          item: {
            type: 'agentMessage',
            text: JSON.stringify({
              answer: 'A line through the origin.',
              quizSuggested: false,
              quizReason: '',
              signals: [],
              recommendations: [],
            }),
          },
        },
      });
      send({
        method: 'turn/completed',
        params: { threadId: 'test-thread', turn: { status: 'completed' } },
      });
    }, 5);
});
