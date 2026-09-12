#!/usr/bin/env node
// Protocol fixture only: never used by the application.
// After `initialize`, closes its own stdin while staying alive and then asks for an approval,
// so Margin's reply lands on a broken pipe. Margin must survive that (no uncaught EPIPE).
import { createInterface } from 'node:readline';
import { closeSync } from 'node:fs';
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
process.stdin.on('error', () => {});
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method } = JSON.parse(line);
  if (id === undefined) return;
  send({ id, result: {} });
  if (method === 'initialize') {
    process.stdin.pause();
    process.stdin.destroy();
    closeSync(0); // destroy() alone keeps the pipe's read end open.
    send({ id: 'server-1', method: 'item/commandExecution/requestApproval', params: {} });
    setInterval(() => {}, 1000);
  }
});
