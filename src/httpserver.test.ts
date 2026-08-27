import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { readBody } from './httpserver.js';
import { TaskBridgeError } from './errors.js';

function fakeReq(chunks: string[]): IncomingMessage {
  const stream = new PassThrough();
  for (const c of chunks) stream.write(c);
  stream.end();
  return stream as unknown as IncomingMessage;
}

test('readBody concatenates chunks into one string', async () => {
  const body = await readBody(fakeReq(['{"a":', '1}']), 1024);
  assert.equal(body, '{"a":1}');
});

test('readBody rejects when the body exceeds the limit', async () => {
  await assert.rejects(
    () => readBody(fakeReq(['x'.repeat(2000)]), 64),
    TaskBridgeError,
  );
});

test('readBody propagates stream errors', async () => {
  const stream = new PassThrough() as unknown as IncomingMessage;
  const promise = readBody(stream, 1024);
  stream.emit('error', new Error('boom'));
  await assert.rejects(() => promise, /boom/);
});
