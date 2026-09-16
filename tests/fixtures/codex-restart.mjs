#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

const first = !existsSync('started');
writeFileSync('started', '');
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
process.on('SIGTERM', () => {
  if (first) {
    appendFileSync('lifecycle.jsonl', 'terminating\n');
    setTimeout(() => {
      appendFileSync('lifecycle.jsonl', 'exited\n');
      process.exit(0);
    }, 250);
  } else process.exit(0);
});
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method } = JSON.parse(line);
  if (id === undefined) return;
  if (first && method === 'initialize') {
    if (!existsSync('timeout-initialize'))
      send({ id, error: { code: -32600, message: 'Initialization rejected' } });
    return;
  }
  send({ id, result: method === 'account/read' ? { account: { type: 'test' } } : {} });
});
