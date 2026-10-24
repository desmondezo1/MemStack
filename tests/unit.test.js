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
    'next-action': '6fa8022309b83e73',
    'done-check': '447bb397c645565a',
    'safety-gate': 'd66fb5cd082cdb56',
    'locate': '7ddb0f5bb58d1e0a',
    'refine-lesson': '49827a408028c5f6',
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

test('normaliseAction checks every tool against the page', async () => {
  const { normaliseAction } = await import('../server/index.js');
  const pg = { elements: [{ id: 'e1', role: 'textbox', label: 'Search' }] };
  assert.equal(normaliseAction({ action: 'type', element_id: 'e1', value: 'x', submit: true }, pg).submit, true);
  assert.equal(normaliseAction({ action: 'click', element_id: 'e9' }, pg).valid, false);
  assert.equal(normaliseAction({ action: 'open_url', value: 'youtube.com' }, pg).value, 'https://youtube.com');
  assert.equal(normaliseAction({ action: 'open_url', value: 'javascript:alert(1)' }, pg).valid, false);
  assert.equal(normaliseAction({ action: 'scroll', value: 'UP' }, pg).value, 'up');
  assert.equal(normaliseAction({ action: 'press', value: 'Enter' }, pg).valid, true);
  assert.equal(normaliseAction({ action: 'press', value: 'F5' }, pg).valid, false);
  for (const action of ['back', 'wait', 'ask_human', 'done']) assert.equal(normaliseAction({ action }, pg).valid, true, action);
  assert.equal(normaliseAction({ action: 'teleport' }, pg).valid, false);
});

test('mock opens the site named in the goal from a blank page', () => {
  const blank = { url: 'about:blank', elements: [] };
  assert.equal(mockAnswer('next-action', { goal: 'open http://x.test/a and play jazz', page: blank, history: [] }).action, 'open_url');
  assert.equal(mockAnswer('next-action', { goal: 'open YouTube and play a Burna Boy video', page: blank, history: [] }).value, 'https://www.youtube.com');
  assert.equal(mockAnswer('next-action', { goal: 'do something', page: blank, history: [] }).action, 'ask_human');
});

test('parseJson also reads tool-call style replies', () => {
  const reply = '<invoke name="click">\n<parameter name="element_id">e28</parameter>\n<parameter name="reason">Open the video</parameter>\n</invoke>';
  assert.deepEqual(parseJson(reply), { action: 'click', element_id: 'e28', reason: 'Open the video' });
  assert.deepEqual(parseJson('<invoke name="type"><parameter name="submit">true</parameter></invoke>'), { action: 'type', submit: true });
});

test('parseJson takes the final answer when the model reconsiders', () => {
  const reply = '{"action":"click","element_id":"e4","reason":"Play"} Wait, let me reconsider. The video is playing. {"action":"done","element_id":"","reason":"Video is playing {already}"}';
  assert.equal(parseJson(reply).action, 'done');
  assert.equal(parseJson('{"a":"} tricky \\" quote","b":1}').b, 1);
});

test('parseJson finds JSON inside a made-up tool call', () => {
  const reply = 'Let me start.\n<function_calls>\n<invoke name="json">\n<invoke name="json">\n{"action":"open_url","value":"http://x.test/"}\n</invoke>\n</function_calls>';
  assert.deepEqual(parseJson(reply), { action: 'open_url', value: 'http://x.test/' });
});

test('API: runs, settings, overview and the live event stream', async () => {
  const events = [];
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = stream.body.getReader();
  const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(new TextDecoder().decode(value)); } } catch {} })();

  assert.equal((await post('/api/runs', { goal: 'g', outcome: 'weird' })).status, 400);
  const run = await (await post('/api/runs', { goal: 'Book a table', outcome: 'failed', steps: 5, tools: ['click'], decisions: 6, invalid: 1 })).json();
  assert.equal(run.outcome, 'failed');
  assert.equal((await post('/api/settings', { adapterCostRatio: -1 })).status, 400);
  const settings = await (await post('/api/settings', { adapterCostRatio: 0.1, adapterLatencyMs: 150 })).json();
  assert.equal(settings.adapterLatencyMs, 150);
  await post('/api/next-action', { goal: 'Book a table for two at eight', page, history: [], sessionId: 's-ev' });

  const overview = await (await fetch(`${base}/api/overview`)).json();
  assert.equal(overview.runs.at(-1).goal, 'Book a table');
  assert.equal(overview.settings.adapterCostRatio, 0.1);
  assert.equal(overview.ledger.totals.adapterMeasured, true);
  assert.match(overview.calls[0].summary, /select "2" in select "Party size"/);
  await post('/api/settings', { adapterCostRatio: null, adapterLatencyMs: null });

  await new Promise(r => setTimeout(r, 100));
  controller.abort();
  await pump;
  const text = events.join('');
  assert.match(text, /event: run/);
  assert.match(text, /event: settings/);
  assert.match(text, /event: call\ndata: .*"task":"next-action"/);
});

test('Anthropic request shape per model generation', async () => {
  const { anthropicBody } = await import('../server/llm.js');
  const old = anthropicBody('claude-haiku-4-5', 'sys', 'hi', 's1');
  assert.equal(old.temperature, 0);
  assert.equal(old.output_config, undefined);
  const next = anthropicBody('claude-haiku-5-5', 'sys', 'hi', 's1');
  assert.equal(next.temperature, undefined); // Haiku 5.5 rejects non-default sampling
  assert.deepEqual(next.output_config, { effort: 'low' });
  assert.ok(next.max_tokens >= 2000); // room for adaptive thinking before the JSON
  assert.deepEqual(next.metadata, { user_id: 's1' });
});

test('ledger prices calls by model', async () => {
  const { costOf } = await import('../server/ledger.js');
  assert.equal(costOf(1_000_000, 0, 'claude-haiku-5-5').costUsd.toFixed(2), '0.10');
  assert.equal(costOf(0, 1_000_000, 'claude-haiku-5-5').costUsd.toFixed(2), '0.50');
  assert.equal(costOf(1_000_000, 1_000_000, 'claude-haiku-4-5').costUsd.toFixed(2), '6.00');
});

test('answers carry no free-text reason; done-check problems read as plain sentences', async () => {
  assert.doesNotMatch(SYSTEM_PROMPTS['next-action'], /"reason"/);
  assert.doesNotMatch(SYSTEM_PROMPTS['done-check'], /"reason"/);
  const { problemText } = await import('../server/index.js');
  assert.match(problemText('wrong_time'), /different time/);
  assert.match(problemText('no_confirmation'), /no confirmation/);
  assert.match(problemText('something-new'), /does not show the goal as done/);
});
