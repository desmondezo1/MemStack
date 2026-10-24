// The Sapling verifier, against a fake Sapling endpoint: request shape, verdicts,
// the log file, and its veto on the done-check and the safety gate.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showme-verifier-'));
const logFile = path.join(dir, 'verifier.log');
Object.assign(process.env, { SHOWME_DATA_DIR: dir, SHOWME_MOCK: '1', MUBIT_API_KEY: '', SAPLING: 'on', SAPLING_LOG: logFile });

// Fake Sapling: "violation" for payment pages and wrong dates, "insufficient_information" otherwise.
const seen = [];
const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const { inputs } = JSON.parse(body);
  seen.push(inputs);
  const bad = /card number|november/i.test(inputs.evidence);
  const probabilities = bad
    ? { supported: 0.05, violation: 0.8, insufficient_information: 0.13, inconsistent_context: 0.02 }
    : { supported: 0.25, violation: 0.05, insufficient_information: 0.68, inconsistent_context: 0.02 };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ raw_label: bad ? 'violation' : 'insufficient_information', status: 'unsure', probabilities }));
});

let server, base;
before(async () => {
  await new Promise(r => fake.listen(0, r));
  process.env.SAPLING_URL = `http://localhost:${fake.address().port}`;
  const { createServer } = await import('../server/index.js');
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); fake.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const goal = 'Book a table for two tonight at eight';

test('verify() sends {inputs: {claim, policy, evidence}} and maps labels to verdicts', async () => {
  const { verify } = await import('../server/verifier.js');
  const r = await verify('Task complete: x', 'policy text', '  page\n text  ');
  assert.equal(r.verdict, 'unsure');
  assert.equal(r.scores.insufficient_information, 0.68);
  assert.deepEqual(seen.at(-1), { claim: 'Task complete: x', policy: 'policy text', evidence: 'page text' });
  const line = JSON.parse(fs.readFileSync(logFile, 'utf8').trim().split('\n').at(-1));
  assert.equal(line.verdict, 'unsure');
  assert.equal(line.inputs.claim, 'Task complete: x');
  assert.ok(line.scores.violation >= 0);
});

test('done-check: the verifier vetoes a "goal met" when the page shows the wrong date', async () => {
  const ok = await post('/api/done-check', { goal, sessionId: 's', page: { url: 'http://x/', text: 'Booking confirmed. Table for 2 guests, Tonight, Sitting C (20:00).' } });
  assert.equal(ok.done, true);
  assert.equal(ok.verifier.verdict, 'unsure');
  const wrong = await post('/api/done-check', { goal, sessionId: 's', page: { url: 'http://x/', text: 'Booking confirmed. Table for 2 guests, Saturday 2 November, Sitting C (20:00).' } });
  assert.equal(wrong.done, false);
  assert.equal(wrong.verifier.verdict, 'fail');
  assert.match(wrong.reason, /verifier disagrees/);
  assert.match(seen.at(-1).claim, /^Task complete: Book a table/);
  assert.match(seen.at(-1).policy, /^Today is .+\. Book a table for two tonight at eight$/);
});

test('safety gate: a payment form is blocked, a normal form is not', async () => {
  const action = { action: 'click', element_id: 'e9' };
  const pay = await post('/api/safety-gate', { goal, sessionId: 's', action, element: { label: 'Pay £40.00', role: 'button' }, evidence: 'Card number Expiry CVC Pay £40.00' });
  assert.equal(pay.allow, false);
  assert.match(pay.reason, /unsafe/);
  assert.equal(seen.at(-1).claim, 'This action is safe under the policy');
  assert.match(seen.at(-1).policy, /Never pay or submit payment details\./);
  const book = await post('/api/safety-gate', { goal, sessionId: 's', action, element: { label: 'Reserve table', role: 'button' }, evidence: 'Party size 2 Sitting C Reserve table' });
  assert.equal(book.allow, true);
});

test('an unreachable verifier never blocks the agent', async () => {
  const saved = process.env.SAPLING_URL;
  process.env.SAPLING_URL = 'http://127.0.0.1:1';
  try {
    const { verifySafe } = await import('../server/verifier.js');
    const r = await verifySafe({ goal, evidence: 'Card number' });
    assert.equal(r.verdict, 'error');
    assert.equal(r.block, false);
  } finally {
    process.env.SAPLING_URL = saved;
  }
});
