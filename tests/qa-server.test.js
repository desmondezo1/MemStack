// QA: server robustness and live-provider request shape, against a local FAKE Mubit.
// Run: node --test tests/qa-server.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showme-qa-server-'));
process.env.SHOWME_DATA_DIR = dataDir;
delete process.env.SHOWME_MOCK;
delete process.env.MUBIT_API_KEY;

const { createServer } = await import('../server/index.js');
const { SYSTEM_PROMPTS } = await import('../server/prompts.js');
const { addDemo, recallDemo, clearDemos } = await import('../server/memory.js');

// ---- fake Mubit -------------------------------------------------------------
const fake = { mode: 'ok', reply: null, calls: [] };
const fakeServer = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const parsed = (() => { try { return JSON.parse(body); } catch { return null; } })();
  fake.calls.push({ url: req.url, method: req.method, headers: req.headers, body: parsed });
  const isOpenAI = req.url.startsWith('/openai/');
  const text = fake.reply ?? (parsed?.system?.includes?.('check whether') || parsed?.messages?.[0]?.content?.includes?.('check whether')
    ? '{"done":false,"reason":"fake"}'
    : '{"action":"click","element_id":"e2","value":"","reason":"fake"}');
  if (fake.mode === '401') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"invalid api key","type":"authentication_error"}}'); }
  if (fake.mode === '500') { res.writeHead(500, { 'content-type': 'text/html' }); return res.end('<html>upstream exploded</html>'); }
  if (fake.mode === 'html200') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>captive portal</html>'); }
  res.writeHead(200, { 'content-type': 'application/json', 'x-middleware-request-id': 'req-123' });
  if (isOpenAI) return res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 10 } }));
});

let server, base, fakeBase;
before(async () => {
  await new Promise(r => fakeServer.listen(0, r));
  fakeBase = `http://127.0.0.1:${fakeServer.address().port}`;
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fakeServer.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function live(provider = 'anthropic') {
  process.env.MUBIT_API_KEY = 'mbt_test';
  process.env.MUBIT_BASE_URL = fakeBase;
  process.env.MUBIT_PROVIDER = provider;
  fake.mode = 'ok'; fake.reply = null; fake.calls = [];
}
function mock() { delete process.env.MUBIT_API_KEY; delete process.env.MUBIT_BASE_URL; delete process.env.MUBIT_PROVIDER; }

const page = {
  url: 'http://shop.test/checkout', title: 'T',
  elements: [{ id: 'e1', role: 'textbox', label: 'Name', value: '' }, { id: 'e2', role: 'button', label: 'Reserve table' }],
};
const raw = (p, body, method = 'POST') => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body });
const post = (p, obj) => raw(p, JSON.stringify(obj));

// ---- robustness (mock mode) -------------------------------------------------
test('qa: bad JSON is 400', async () => {
  mock();
  const r = await raw('/api/next-action', '{nope');
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not JSON/);
});

test('qa: JSON body "null" is a 400, not a 500 crash', async () => {
  mock();
  const r = await raw('/api/next-action', 'null');
  assert.equal(r.status, 400, `got ${r.status}: ${await r.text()}`);
});

test('qa: non-array history is a 400, not a 500', async () => {
  mock();
  const r = await post('/api/next-action', { goal: 'g', page, sessionId: 's', history: 'oops' });
  assert.equal(r.status, 400, `got ${r.status}: ${await r.text()}`);
});

test('qa: missing fields on every POST route are 400', async () => {
  mock();
  for (const p of ['/api/next-action', '/api/done-check', '/api/safety-gate', '/api/demonstrations']) {
    const r = await post(p, {});
    assert.equal(r.status, 400, p);
  }
  const r = await post('/api/demonstrations', { goal: 'g', url: 'u', steps: [] });
  assert.equal(r.status, 400);
});

test('qa: demonstration step without page does not crash the route', async () => {
  mock();
  const r = await post('/api/demonstrations', { goal: 'g', url: 'http://x.test/', steps: [{ action: 'click', label: 'A' }] });
  // Either reject with 400 or accept and report a training error, but never 500.
  assert.notEqual(r.status, 500, await r.text());
});

test('qa: huge body gets a 413 response (not a reset socket)', async () => {
  mock();
  const big = '{"goal":"' + 'x'.repeat(3_000_000) + '"}';
  const res = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/next-action', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(big) } }, r => {
      let b = ''; r.on('data', c => (b += c)); r.on('end', () => resolve({ status: r.statusCode, body: b }));
    });
    req.on('error', err => resolve({ status: 'socket-error', body: err.code }));
    req.end(big);
  });
  assert.equal(res.status, 413, JSON.stringify(res));
});

test('qa: /demo/ path traversal variants are refused', async () => {
  mock();
  const paths = ['/demo/../package.json', '/demo/%2e%2e/package.json', '/demo/..%2f..%2fpackage.json', '/demo..', '/demo/..\\..\\package.json', '/demo/%2e%2e%2fllm.js', '/demo/../llm.js'];
  for (const p of paths) {
    // raw socket so the client does not normalise the path first
    const status = await new Promise(resolve => {
      const s = net.connect(server.address().port, '127.0.0.1', () => s.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
      let b = ''; s.on('data', c => (b += c)); s.on('end', () => resolve(b));
    });
    assert.doesNotMatch(status, /"name": "memstack-show-me"|export function/, p);
    assert.doesNotMatch(status.split('\r\n')[0], /200/, `${p} -> ${status.split('\r\n')[0]}`);
  }
});

test('qa: recall ignores zero-overlap goals? (documents current behaviour)', () => {
  clearDemos();
  addDemo({ goal: 'book a table for two at eight', url: 'http://site.test/book', steps: [{ action: 'click', label: 'Sitting C' }] });
  const unrelated = recallDemo({ url: 'http://site.test/book', goal: 'subscribe to the newsletter' });
  clearDemos();
  assert.equal(unrelated, null, 'a lesson for a totally different goal on the same page is recalled');
});

test('qa: multi-page lesson is recalled on the second page of the flow', () => {
  clearDemos();
  addDemo({ goal: 'book a table at eight', url: 'http://site.test/step1', steps: [
    { action: 'click', label: 'Book', page: { url: 'http://site.test/step1' } },
    { action: 'click', label: 'Sitting C', page: { url: 'http://site.test/step2' } },
  ] });
  const onStep2 = recallDemo({ url: 'http://site.test/step2?name=Alex', goal: 'book a table at eight' });
  clearDemos();
  assert.ok(onStep2, 'lesson recorded across two pages is not recalled once the agent reaches page 2');
});

// ---- live provider via fake Mubit -------------------------------------------
test('qa: anthropic request shape', async () => {
  live('anthropic');
  const r = await post('/api/next-action', { goal: 'Book', page, history: [], sessionId: 'run-42' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.requestId, 'req-123');
  assert.equal(j.valid, true);
  const c = fake.calls.at(-1);
  assert.equal(c.url, '/anthropic/v1/messages');
  assert.equal(c.headers['x-api-key'], 'mbt_test');
  assert.equal(c.headers['anthropic-version'], '2023-06-01');
  assert.equal(c.body.system, SYSTEM_PROMPTS['next-action']);
  assert.equal(c.body.metadata.user_id, 'run-42');
  assert.equal(c.body.model, 'claude-haiku-4-5');
  assert.equal(c.body.messages[0].role, 'user');
  assert.match(c.body.messages[0].content, /^Goal: Book/);

  await post('/api/done-check', { goal: 'Book', page: { url: page.url, text: 'hi' }, sessionId: 'run-42' });
  assert.equal(fake.calls.at(-1).body.system, SYSTEM_PROMPTS['done-check']);
  await post('/api/safety-gate', { goal: 'Book', action: { action: 'click' }, element: { label: 'Pay' }, sessionId: 'run-42' });
  assert.equal(fake.calls.at(-1).body.system, SYSTEM_PROMPTS['safety-gate']);
});

test('qa: openai request shape', async () => {
  live('openai');
  const r = await post('/api/next-action', { goal: 'Book', page, history: [], sessionId: 'run-43' });
  assert.equal(r.status, 200);
  const c = fake.calls.at(-1);
  assert.equal(c.url, '/openai/v1/chat/completions');
  assert.equal(c.headers.authorization, 'Bearer mbt_test');
  assert.equal(c.body.messages[0].role, 'system');
  assert.equal(c.body.messages[0].content, SYSTEM_PROMPTS['next-action']);
  assert.equal(c.body.metadata.session_id, 'run-43');
});

test('qa: training calls share the demo session and the fixed system prompt', async () => {
  live('anthropic');
  fake.reply = '{"action":"click","element_id":"e2","value":"","reason":"x"}';
  const steps = [{ action: 'click', element_id: 'e2', label: 'Reserve table', role: 'button', value: '', page }];
  const r = await (await post('/api/demonstrations', { goal: 'Book', url: page.url, steps })).json();
  assert.equal(r.training.sent, 1);
  assert.equal(r.training.agreed, 1);
  const c = fake.calls.at(-1);
  assert.equal(c.body.system, SYSTEM_PROMPTS['next-action']);
  assert.equal(c.body.metadata.user_id, `demo-${r.demo.id}`);
  assert.match(c.body.messages[0].content, /Demonstration recorded by a human/);
  clearDemos();
});

test('qa: model reply referencing a missing element -> valid:false', async () => {
  live('anthropic');
  fake.reply = '{"action":"click","element_id":"e999","reason":"hallucinated"}';
  const j = await (await post('/api/next-action', { goal: 'Book', page, history: [], sessionId: 's' })).json();
  assert.equal(j.valid, false);
  assert.equal(j.label, null);
});

test('qa: model reply that is not JSON -> 422 (agent error, teachable) with message', async () => {
  live('anthropic');
  fake.reply = 'I would click the button.';
  const r = await post('/api/next-action', { goal: 'Book', page, history: [], sessionId: 's' });
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /not JSON/);
});

test('qa: provider 401 -> 502 with the provider message', async () => {
  live('anthropic');
  fake.mode = '401';
  const r = await post('/api/next-action', { goal: 'Book', page, history: [], sessionId: 's' });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /401: invalid api key/);
});

test('qa: provider 500 with HTML body -> 502', async () => {
  live('anthropic');
  fake.mode = '500';
  const r = await post('/api/next-action', { goal: 'Book', page, history: [], sessionId: 's' });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /500/);
});

test('qa: provider 200 with non-JSON body -> 502 and readable error', async () => {
  live('anthropic');
  fake.mode = 'html200';
  const r = await post('/api/next-action', { goal: 'Book', page, history: [], sessionId: 's' });
  const j = await r.json();
  assert.equal(r.status, 502, `got ${r.status}: ${j.error}`);
});

test('qa: provider unreachable -> 502', async () => {
  live('anthropic');
  process.env.MUBIT_BASE_URL = 'http://127.0.0.1:1';
  const r = await post('/api/next-action', { goal: 'Book', page, history: [], sessionId: 's' });
  const j = await r.json();
  assert.equal(r.status, 502, `got ${r.status}: ${j.error}`);
});

test('qa: ledger counts live failures as errors, real calls as sent', async () => {
  const l = await (await fetch(base + '/api/ledger')).json();
  const na = l.tasks.find(t => t.task === 'next-action');
  assert.ok(na.errors >= 4, JSON.stringify(na));
  assert.ok(na.sentToMubit >= 3);
  assert.ok(na.providerCostPer1k > 0);
  mock();
});

test('qa: seed-traffic hits the fake gateway with the fixed prompts', async () => {
  live('anthropic');
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showme-seed-'));
  const out = await new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'scripts/seed-traffic.js'), '--count', '5', '--checks', '2'], {
      cwd: root, timeout: 60_000,
      env: { ...process.env, SHOWME_DATA_DIR: seedDir, MUBIT_API_KEY: 'mbt_test', MUBIT_BASE_URL: fakeBase, MUBIT_PROVIDER: 'anthropic' },
    }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
  assert.equal(out.err, null, out.stderr);
  assert.match(out.stdout, /Done: 7 sent, 0 failed/);
  assert.equal(fake.calls.length, 7);
  const systems = new Set(fake.calls.map(c => c.body.system));
  assert.deepEqual([...systems].sort(), [SYSTEM_PROMPTS['done-check'], SYSTEM_PROMPTS['next-action']].sort());
  assert.equal(fake.calls.filter(c => c.body.system === SYSTEM_PROMPTS['next-action']).length, 5);
  for (const c of fake.calls) {
    assert.equal(c.url, '/anthropic/v1/messages');
    assert.equal(c.headers['x-api-key'], 'mbt_test');
    assert.match(c.body.metadata.user_id, /^seed-(na|dc)-/);
  }
  const ids = new Set(fake.calls.map(c => c.body.metadata.user_id));
  assert.equal(ids.size, 7, 'each seed call gets its own session');
  fs.rmSync(seedDir, { recursive: true, force: true });
  mock();
});

test('qa: seed-traffic stops on a 401 with a readable message', async () => {
  live('anthropic');
  fake.mode = '401';
  const out = await new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'scripts/seed-traffic.js'), '--count', '3', '--checks', '0'], {
      cwd: root, timeout: 60_000,
      env: { ...process.env, SHOWME_DATA_DIR: dataDir, MUBIT_API_KEY: 'mbt_test', MUBIT_BASE_URL: fakeBase },
    }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
  console.log('seed 401 stderr:', out.stderr.split('\n').slice(0, 6).join(' | '));
  assert.ok(out.err, 'exits non-zero');
  mock();
});
