import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showme-unit-'));
process.env.SHOWME_DATA_DIR = dataDir;
process.env.SHOWME_MOCK = '1';

const { SYSTEM_PROMPTS, buildNextActionMessage } = await import('../server/prompts.js');
const { goalTime, partySize, mockAnswer } = await import('../server/mock.js');
const { addDemo, recallDemo, clearDemos } = await import('../server/memory.js');
const { createServer } = await import('../server/index.js');
const { parseJson } = await import('../server/llm.js');

// Changing a system prompt makes Mubit start a brand-new task (example count back to 0).
// If you really mean to change one, update the hash here and tell the team.
test('system prompts are unchanged (Mubit task fingerprints)', () => {
  const hashes = Object.fromEntries(Object.entries(SYSTEM_PROMPTS).map(([k, v]) => [k, crypto.createHash('sha256').update(v).digest('hex').slice(0, 16)]));
  assert.deepEqual(hashes, {
    'next-action': '5573001f9d9f4475',
    'done-check': '0d1ab2abb424237b',
    'safety-gate': 'd66fb5cd082cdb56',
  });
});

test('goal parsing', () => {
  assert.equal(goalTime('Book a table for two at eight'), '20:00');
  assert.equal(goalTime('book for 4 at 8pm'), '20:00');
  assert.equal(goalTime('table at quarter past nine'), '21:15');
  assert.equal(goalTime('table at 17:30'), '17:30');
  assert.equal(goalTime('book a table'), null);
  assert.equal(partySize('Book a table for two at eight'), 2);
  assert.equal(partySize('table for 6'), 6);
});

test('parseJson tolerates fences and prose', () => {
  assert.deepEqual(parseJson('```json\n{"done": true}\n```'), { done: true });
  assert.deepEqual(parseJson('Sure: {"a":1} thanks'), { a: 1 });
  assert.equal(parseJson('no json'), null);
});

const page = {
  url: 'http://localhost/demo/',
  title: 'Book',
  elements: [
    { id: 'e1', role: 'select', label: 'Party size', value: '', options: ['1', '2', '3'] },
    { id: 'e2', role: 'radio', label: 'Sitting A', group: 'Sitting', checked: false },
    { id: 'e3', role: 'radio', label: 'Sitting C', group: 'Sitting', checked: false },
    { id: 'e4', role: 'textbox', label: 'Name for the booking', value: '' },
    { id: 'e5', role: 'button', label: 'Reserve table' },
  ],
};

test('mock agent guesses the first sitting without a lesson, follows a lesson with one', () => {
  const history = [{ action: 'select', label: 'Party size', value: '2' }];
  const guess = mockAnswer('next-action', { goal: 'Book a table for two at eight', page, history });
  assert.equal(guess.element_id, 'e2');

  const demo = { goal: 'book a table for two at eight', steps: [
    { action: 'select', label: 'Party size', value: '2' },
    { action: 'click', label: 'Sitting C' },
  ] };
  const taught = mockAnswer('next-action', { goal: 'Book a table for two at eight', page, history, demo });
  assert.equal(taught.element_id, 'e3');
});

test('mock done-check catches the wrong time', () => {
  const wrong = mockAnswer('done-check', { goal: 'table for two at eight', page: { text: 'Booking confirmed. Table for 2 guests, Tonight, Sitting A (17:30).' } });
  assert.equal(wrong.done, false);
  const right = mockAnswer('done-check', { goal: 'table for two at eight', page: { text: 'Booking confirmed. Table for 2 guests, Tonight, Sitting C (20:00).' } });
  assert.equal(right.done, true);
});

test('demonstrations are recalled by page and goal, newest first on ties', () => {
  clearDemos();
  addDemo({ goal: 'book a table for two at eight', url: 'http://localhost/demo/?x=1', steps: [{ action: 'click', label: 'Old' }] });
  addDemo({ goal: 'book a table for two at eight', url: 'http://localhost/demo/', steps: [{ action: 'click', label: 'New' }] });
  addDemo({ goal: 'cancel my order', url: 'http://localhost/other', steps: [{ action: 'click', label: 'Other' }] });
  assert.equal(recallDemo({ url: 'http://localhost/demo/', goal: 'Book a table for two at eight' }).steps[0].label, 'New');
  assert.equal(recallDemo({ url: 'http://elsewhere/', goal: 'Book a table' }), null);
  clearDemos();
});

test('user message keeps varying content out of the system prompt', () => {
  const msg = buildNextActionMessage({ goal: 'G', page, history: [], demo: null });
  assert.match(msg, /^Goal: G/);
  assert.match(msg, /e3 radio "Sitting C" group="Sitting" checked=false/);
});

let server;
let base;
before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('API: health, next-action, demonstrations, ledger', async () => {
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.provider, 'mock');

  const bad = await post('/api/next-action', { goal: 'x' });
  assert.equal(bad.status, 400);

  const next = await (await post('/api/next-action', { goal: 'Book a table for two at eight', page, history: [], sessionId: 's1' })).json();
  assert.equal(next.action, 'select');
  assert.equal(next.valid, true);
  assert.equal(next.label, 'Party size');

  const steps = [
    { action: 'select', element_id: 'e1', label: 'Party size', role: 'select', value: '2', page },
    { action: 'click', element_id: 'e3', label: 'Sitting C', role: 'radio', value: '', page },
  ];
  const saved = await (await post('/api/demonstrations', { goal: 'Book a table for two at eight', url: page.url, steps })).json();
  assert.equal(saved.training.sent, 2);
  assert.equal(saved.training.agreed, 2);

  const ledger = await (await fetch(`${base}/api/ledger`)).json();
  const na = ledger.tasks.find(t => t.task === 'next-action');
  assert.equal(na.live, 1);
  assert.equal(na.training, 2);

  const demo = await (await fetch(`${base}/api/demo/`)).status;
  assert.equal(demo, 404);
  const site = await fetch(`${base}/demo/`);
  assert.equal(site.status, 200);
  assert.match(await site.text(), /Trattoria Nove/);
  const traversal = await fetch(`${base}/demo/..%2f..%2fpackage.json`);
  assert.equal(traversal.status, 404);
});
