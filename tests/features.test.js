// Lesson clean-up (detours), answering questions from the page, and answer lessons.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showme-features-'));
Object.assign(process.env, { SHOWME_DATA_DIR: dir, SHOWME_MOCK: '1', MUBIT_API_KEY: '' });

const { findDetours, forTraining } = await import('../server/refine.js');
const { isQuestion } = await import('../extension/agent-core.js');
const { createServer } = await import('../server/index.js');

const at = url => ({ url, elements: [] });
const G = 'https://www.google.com/search?q=burna+boy';

test('a result opened and abandoned is a detour; the one you kept is not', () => {
  const steps = [
    { action: 'type', label: 'Search', value: 'burna boy', submit: true, page: at('https://www.google.com/'), led_to: G },
    { action: 'click', label: 'Burna Boy - Wikipedia', page: at(G), led_to: 'https://en.wikipedia.org/wiki/Burna_Boy' },
    { action: 'open_url', value: G, page: at('https://en.wikipedia.org/wiki/Burna_Boy'), led_to: G },
    { action: 'click', label: 'Burna Boy - Official Site', page: at(G), led_to: 'https://burnaboy.com/' },
  ];
  const { drop, why } = findDetours(steps);
  assert.deepEqual([...drop].sort(), [1, 2]);
  assert.match(why[1], /came back/);
});

test('corrected typing, a ticked-then-unticked box and new tabs are dropped', () => {
  const p = at('https://shop.example/');
  const steps = [
    { action: 'new_tab', page: at('about:blank') },
    { action: 'type', label: 'Search', value: 'burna', page: p },
    { action: 'click', role: 'checkbox', label: 'Free delivery', page: p },
    { action: 'click', role: 'checkbox', label: 'Free delivery', page: p },
    { action: 'type', label: 'Search', value: 'burna boy', page: p },
  ];
  const { drop } = findDetours(steps);
  assert.deepEqual([...drop].sort(), [0, 1, 2, 3]);
  const mapped = forTraining([{ action: 'new_tab', page: p }, { action: 'switch_tab', value: 'https://x.example/', page: p }]);
  assert.deepEqual(mapped.map(s => [s.action, s.value]), [['open_url', 'https://x.example/']]);
});

test('questions are told apart from tasks', () => {
  for (const q of ['What time do they open on Sunday?', 'where is the vegetarian info', 'Show me where the address is', 'highlight the opening hours', 'find the price on this page'])
    assert.equal(isQuestion(q), true, q);
  for (const t of ['Book a table for two at eight', 'Open YouTube and play a Burna Boy video', 'find running shoes on Amazon'])
    assert.equal(isQuestion(t), false, t);
});

let server, base;
before(async () => { server = createServer(); await new Promise(r => server.listen(0, r)); base = `http://localhost:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

const faq = {
  url: 'http://localhost/demo/', title: 'Trattoria Nove', elements: [],
  blocks: [
    { id: 'e40', tag: 'h2', text: 'Opening hours' },
    { id: 'e41', tag: 'dt', text: 'Sunday' },
    { id: 'e42', tag: 'dd', text: '12:00–21:00, Sunday roast until 16:00' },
    { id: 'e43', tag: 'dt', text: 'Dogs' },
    { id: 'e44', tag: 'dd', text: 'Well-behaved dogs are welcome at the bar tables.' },
  ],
};

test('locate: the block that answers the question, or "not here"', async () => {
  const sunday = await post('/api/locate', { goal: 'What time do they open on Sunday?', page: faq, sessionId: 's' });
  assert.equal(sunday.found, true);
  assert.equal(sunday.block_id, 'e42');
  assert.match(sunday.answer, /12:00–21:00/);
  const none = await post('/api/locate', { goal: 'Is there parking for bicycles?', page: faq, sessionId: 's' });
  assert.equal(none.found, false);
});

test('refine-lesson suggests the detours; a lesson with an answer trains locate', async () => {
  const steps = [
    { action: 'click', label: 'Result one', page: { url: G }, led_to: 'https://a.example/' },
    { action: 'click', label: 'Result two', page: { url: G }, led_to: 'https://b.example/' },
  ];
  const review = await post('/api/refine-lesson', { goal: 'find the official site', steps });
  assert.deepEqual(review.keep, [false, true]);
  assert.match(review.why[0], /came back/);

  const saved = await post('/api/demonstrations', {
    goal: 'When does the Sunday roast end?', url: faq.url,
    steps: [{ action: 'highlight', element_id: 'e42', label: '12:00–21:00, Sunday roast until 16:00', role: 'text', value: 'Sunday roast until 16:00', page: faq }],
  });
  assert.equal(saved.training.sent, 1);
  assert.equal(saved.demo.answers[0].value, 'Sunday roast until 16:00');
  const recalled = await post('/api/locate', { goal: 'When does the Sunday roast end?', page: faq, sessionId: 's2' });
  assert.equal(recalled.block_id, 'e42');
  assert.ok(recalled.demoUsed);
});

test('privacy floor: "accept cookies" becomes "reject" when the banner offers it', async () => {
  const { privacyFloor } = await import('../extension/agent-core.js');
  const page = { text: 'We use cookies to improve your experience.', elements: [
    { id: 'e1', role: 'button', label: 'Accept all' }, { id: 'e2', role: 'button', label: 'Reject all' }] };
  const swapped = privacyFloor({ action: 'click', element_id: 'e1', label: 'Accept all', role: 'button' }, page);
  assert.equal(swapped.element_id, 'e2');
  assert.match(swapped.reason, /privacy/);
  // No reject button, or not a cookie banner: unchanged.
  assert.equal(privacyFloor({ action: 'click', element_id: 'e1', label: 'Accept all' }, { ...page, elements: [page.elements[0]] }).element_id, 'e1');
  assert.equal(privacyFloor({ action: 'click', element_id: 'e1', label: 'Accept invitation' }, { text: 'Team invite', elements: page.elements }).element_id, 'e1');
});

test('almost-JSON replies still give the fields to act on', async () => {
  const { parseJson } = await import('../server/llm.js');
  const r = parseJson('{"action":"type","element_id":"e3","value":"Burna Boy","submit":true,"reason":"type "Burna Boy" then Enter"}');
  assert.deepEqual([r.action, r.element_id, r.value, r.submit], ['type', 'e3', 'Burna Boy', true]);
});
