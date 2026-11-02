import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTranscript, redact } from '../src/transcript.js';

test('lines are appended as JSON, the file is private, and redaction removes the user id everywhere', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-')), 't.jsonl');
  const t = makeTranscript(p);
  t.log('in', 4242, '/regmsg bot1 0xabc', 100);
  t.log('out', 4242, 'Sign this\n\nowner:4242\nname:bot1', 101);
  assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.dir), ['in', 'out']);
  const r = redact(lines, 4242);
  assert.equal(JSON.stringify(r).includes('4242'), false);
  assert.match(r[1].text, /owner:owner/);
});
test('with no path nothing is written and nothing throws', () => makeTranscript('').log('in', 1, 'x'));
