// QA: extension end to end on fixture pages (recorder, snapshot, multi-page, repeated runs,
// stop, provider errors, offline, ledger, mic, dark mode). Mock model unless a test points
// the in-process server at a local FAKE Mubit.
// Run: node --test tests/qa-e2e.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showme-qa-e2e-'));
process.env.SHOWME_DATA_DIR = dataDir;
process.env.SHOWME_MOCK = '1';
delete process.env.MUBIT_API_KEY;
const shots = path.join(root, 'test-results');
fs.mkdirSync(shots, { recursive: true });

const { createServer } = await import('../server/index.js');

// ---- fixture site ----------------------------------------------------------------
const html = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const FIX = {
  '/rec': html('Recorder fixture', `
    <h1>Recorder</h1>
    <fieldset><legend>Size</legend>
      <label id="lsmall"><input type="radio" name="size" value="s"> Small</label>
      <label id="llarge"><input type="radio" name="size" value="l"> Large</label>
    </fieldset>
    <label id="lterms"><input type="checkbox" id="terms"> I agree</label>
    <input type="checkbox" id="news"><label for="news" id="lnews">Newsletter</label>
    <label for="fname">First name</label><input id="fname">
    <label for="pw">Password</label><input type="password" id="pw">
    <label for="color">Colour</label><select id="color"><option value="">Pick</option><option>Red</option><option>Blue</option></select>
    <div id="notes" contenteditable="true" aria-label="Notes" style="border:1px solid;min-height:30px"></div>
    <p id="plain">Just some text</p>
    <a href="#section" id="anchor">Jump</a>
    <button type="button" id="go">Go</button>
    <div id="section" style="height:50px">section</div>`),

  '/snap': html('Snapshot fixture', `
    <h1>Snap</h1>
    <button id="b-visible">Visible button</button>
    <button style="display:none">Display none</button>
    <button style="visibility:hidden">Visibility hidden</button>
    <button style="opacity:0">Opacity zero</button>
    <button hidden>Hidden attr</button>
    <div style="display:none"><a href="/x">Link in hidden parent</a></div>
    <details><summary>More</summary><button>Inside closed details</button></details>
    <button aria-label="Close dialog">×</button>
    <span id="lbl">Email address</span><input aria-labelledby="lbl">
    <label><input type="radio" name="c" style="opacity:0;position:absolute"> Custom radio</label>
    <input type="text" placeholder="Search here">
    <div style="height:6000px"></div>
    <button>Far below</button>`),

  '/modal-long': html('Long page with modal', `
    <h1>News</h1>
    ${Array.from({ length: 100 }, (_, i) => `<a href="/a${i}">Article ${i}</a>`).join(' ')}
    <div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:#0008"><div style="background:#fff;padding:20px">
      <p>We value your privacy</p><button>Accept all</button><button>Reject all</button></div></div>`),

  '/closed-dialog': html('Closed dialog', `
    <h1>Page</h1><button>Page button</button>
    <dialog><button>Dialog button</button></dialog>`),

  // Multi-page booking: name -> (navigate) sitting with hidden times -> (navigate) confirmation.
  '/mp/1': html('Book — step 1', `
    <h1>Book a table</h1>
    <form action="/mp/2" method="get">
      <label for="name">Name for the booking</label><input id="name" name="name">
      <button>Book</button>
    </form>`),
  '/mp/2': html('Book — step 2', `
    <h1>Pick a sitting</h1>
    <form action="/mp/3" method="get">
      <input type="hidden" name="name" value="__NAME__">
      <fieldset><legend>Sitting</legend>
        <label title="17:30"><input type="radio" name="s" value="A|17:30"> Sitting A</label>
        <label title="20:00"><input type="radio" name="s" value="C|20:00"> Sitting C</label>
      </fieldset>
      <button>Confirm</button>
    </form>`),
  '/mp/3': html('Book — done', `<h1>Thanks</h1><p id="msg">__MSG__</p>`),

  // One navigation with a slow server response (the agent must wait for it).
  '/slow/1': html('Slow — step 1', `
    <h1>Reserve</h1>
    <form action="/slow/2" method="get">
      <label for="name">Name for the booking</label><input id="name" name="name">
      <button>Reserve</button>
    </form>`),
  '/slow/2': html('Slow — done', `<h1>Booking confirmed</h1><p>See you soon.</p>`),
};

const fixture = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = FIX[u.pathname];
  if (!body) { res.writeHead(404); return res.end('nf'); }
  if (u.pathname === '/mp/2') body = body.replace('__NAME__', (u.searchParams.get('name') || '').replace(/"/g, ''));
  if (u.pathname === '/mp/3') {
    const [s, time] = (u.searchParams.get('s') || '').split('|');
    body = body.replace('__MSG__', s ? `Booking confirmed for ${u.searchParams.get('name')}: Sitting ${s} (${time}).` : 'Please choose a sitting.');
  }
  if (u.pathname === '/slow/2') await new Promise(r => setTimeout(r, 2000));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
});

// ---- fake Mubit ----------------------------------------------------------------------
const fake = { mode: 'ok' };
const fakeMubit = http.createServer(async (req, res) => {
  for await (const _ of req);
  if (fake.mode === '401') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"invalid api key"}}'); }
  if (fake.mode === 'prose') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ content: [{ type: 'text', text: 'I think you should click it.' }] })); }
  if (fake.mode === 'ghost') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ content: [{ type: 'text', text: '{"action":"click","element_id":"e999","reason":"ghost"}' }] })); }
  res.writeHead(500); res.end('boom');
});

let server, base, fixBase, fakeBase, context, worker, extId;

before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  await new Promise(r => fixture.listen(0, r));
  fixBase = `http://localhost:${fixture.address().port}`;
  await new Promise(r => fakeMubit.listen(0, r));
  fakeBase = `http://127.0.0.1:${fakeMubit.address().port}`;
  const ext = path.join(root, 'extension');
  context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'showme-qa-profile-')), {
    channel: 'chromium',
    headless: process.env.HEADED !== '1',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extId = new URL(worker.url()).host;
  await worker.evaluate(server => chrome.storage.local.set({ server, goal: '' }), base);
});

after(async () => {
  await context?.close();
  server?.close(); fixture.close(); fakeMubit.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ---- helpers --------------------------------------------------------------------
async function openSite(url) {
  const site = await context.newPage();
  await site.goto(url);
  const tabId = await worker.evaluate(async u => (await chrome.tabs.query({})).filter(t => t.url === u).sort((a, b) => b.id - a.id)[0]?.id, site.url());
  assert.ok(tabId, `tab for ${url}`);
  return { site, tabId };
}
async function openPanel(tabId, { initScript } = {}) {
  const panel = await context.newPage();
  if (initScript) await panel.addInitScript(initScript);
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await panel.waitForSelector('#mode.mock, #mode.live, #mode.down', { timeout: 10_000 });
  return panel;
}
const snap = tabId => worker.evaluate(async id => (await chrome.tabs.sendMessage(id, { type: 'showme:snapshot' })).page, tabId);
async function runGoal(panel, goal, timeout = 40_000) {
  await panel.fill('#goal', goal);
  await panel.click('#run');
  await panel.waitForSelector('#verdict:not([hidden])', { timeout });
  return { verdict: await panel.textContent('#verdict'), timeline: (await panel.textContent('#timeline')).replace(/\s+/g, ' ') };
}
const clearMemory = () => fetch(`${base}/api/demonstrations`, { method: 'DELETE' });
const recordedList = panel => panel.$$eval('#recorded li .what-text', lis => lis.map(li => li.textContent));

// Teach the demo restaurant by hand (same as tests/e2e.test.js), choosing a sitting.
async function teachDemo(panel, site, sitting = 'Sitting C') {
  await panel.click('#show-me');
  await site.waitForSelector('#showme-recording-badge', { timeout: 10_000 });
  await site.click('#no-thanks');
  await site.selectOption('#party', '2');
  await site.getByLabel(sitting).check();
  await site.fill('#name', 'Alex');
  await site.click('button[type=submit]');
  await panel.waitForFunction(() => document.querySelectorAll('#recorded li').length >= 5);
  await panel.click('#done-teaching');
  await panel.waitForFunction(() => /Learned|Could not/.test(document.querySelector('#saved-summary').textContent));
  return panel.textContent('#saved-summary');
}

// ---- 1. repeated flow, second lesson, forget, stop ----------------------------------
test('qa: repeated runs, second lesson for same goal, forget lessons', { timeout: 180_000 }, async () => {
  await clearMemory();
  const GOAL = 'Book a table for two at eight';
  const { site, tabId } = await openSite(`${base}/demo/`);
  const panel = await openPanel(tabId);

  let r = await runGoal(panel, GOAL);
  assert.equal(r.verdict, 'Failed');
  // First lesson teaches the WRONG sitting (A); second lesson teaches C. Newest must win.
  assert.match(await teachDemo(panel, site, 'Sitting A'), /Learned/);
  await site.goto(`${base}/demo/`);
  r = await runGoal(panel, GOAL);
  assert.equal(r.verdict, 'Failed', 'wrong lesson should still fail the done-check');
  assert.match(await teachDemo(panel, site, 'Sitting C'), /Learned/);
  assert.match(await panel.textContent('#memory-count'), /2 lessons/);
  await panel.click('#rerun');
  await panel.waitForSelector('#verdict', { state: 'hidden' });
  await panel.waitForSelector('#verdict:not([hidden])', { timeout: 40_000 });
  assert.equal(await panel.textContent('#verdict'), 'Done ✓', 'newest lesson (Sitting C) wins');

  // Run again from a fresh load, several times in a row: stays green.
  for (let i = 0; i < 2; i++) {
    await site.goto(`${base}/demo/`);
    r = await runGoal(panel, GOAL);
    assert.equal(r.verdict, 'Done ✓', `repeat ${i}: ${r.timeline}`);
  }

  // Forget lessons -> memory 0 -> fails again.
  await panel.click('#forget');
  await panel.waitForFunction(() => /No lessons yet/.test(document.querySelector('#memory-count').textContent));
  await site.goto(`${base}/demo/`);
  r = await runGoal(panel, GOAL);
  assert.equal(r.verdict, 'Failed');
  await panel.close(); await site.close();
});

test('qa: Stop mid-run stops, re-enables Run, offers no teaching', { timeout: 60_000 }, async () => {
  await clearMemory();
  const { site, tabId } = await openSite(`${base}/demo/`);
  const panel = await openPanel(tabId);
  await panel.fill('#goal', 'Book a table for two at eight');
  await panel.click('#run');
  await panel.waitForFunction(() => document.querySelectorAll('#timeline li').length >= 2);
  await panel.click('#stop');
  await panel.waitForSelector('#verdict:not([hidden])', { timeout: 10_000 });
  const steps = await panel.$$eval('#timeline li', l => l.length);
  assert.ok(steps <= 3, `stopped after ${steps} steps`);
  assert.equal(await panel.textContent('#verdict'), 'Stopped');
  assert.equal(await panel.isHidden('#teach'), true);
  assert.equal(await panel.isEnabled('#run'), true);
  assert.equal(await panel.isHidden('#stop'), true);
  await panel.close(); await site.close();
});

// ---- 2. multi-page ----------------------------------------------------------------
test('qa: agent loop survives a slow navigation (waitForLoad)', { timeout: 60_000 }, async () => {
  await clearMemory();
  const { site, tabId } = await openSite(`${fixBase}/slow/1`);
  const panel = await openPanel(tabId);
  const r = await runGoal(panel, 'Make a booking');
  console.log('slow nav:', r.verdict, '|', r.timeline);
  assert.equal(r.verdict, 'Done ✓', r.timeline);
  await panel.close(); await site.close();
});

test('qa: multi-page: run, teach across navigation, rerun', { timeout: 120_000 }, async () => {
  await clearMemory();
  const GOAL = 'Book a table at eight';
  const { site, tabId } = await openSite(`${fixBase}/mp/1`);
  const panel = await openPanel(tabId);

  let r = await runGoal(panel, GOAL);
  console.log('mp run 1:', r.verdict, '|', r.timeline);
  assert.equal(r.verdict, 'Failed');
  assert.match(r.timeline, /click “Book”/);

  await panel.click('#show-me');
  await site.waitForSelector('#showme-recording-badge', { timeout: 10_000 });
  await site.fill('#name', 'Alex');
  await site.click('button');
  await site.waitForURL(/\/mp\/2/);
  await site.waitForSelector('#showme-recording-badge', { timeout: 10_000 });
  await site.getByLabel('Sitting C').check();
  await site.click('button');
  await site.waitForURL(/\/mp\/3/);
  await panel.waitForFunction(() => document.querySelectorAll('#recorded li').length >= 4, null, { timeout: 10_000 }).catch(() => {});
  const rec = await recordedList(panel);
  console.log('mp recorded:', rec);
  assert.deepEqual(rec, ['type “Alex” into “Name for the booking”', 'click “Book”', 'click “Sitting C”', 'click “Confirm”']);
  await panel.click('#done-teaching');
  await panel.waitForFunction(() => /Learned|Could not/.test(document.querySelector('#saved-summary').textContent));

  await panel.click('#rerun');
  await panel.waitForSelector('#verdict', { state: 'hidden' });
  await panel.waitForSelector('#verdict:not([hidden])', { timeout: 40_000 });
  const t2 = (await panel.textContent('#timeline')).replace(/\s+/g, ' ');
  console.log('mp rerun:', await panel.textContent('#verdict'), '|', t2, '| page:', site.url());
  assert.equal(await panel.textContent('#verdict'), 'Done ✓', 'multi-page lesson not used on page 2: ' + t2);
  await panel.close(); await site.close();
});

// ---- 3. recorder ------------------------------------------------------------------
test('qa: recorder: labels, checkbox, typing+click, select, contenteditable, password, plain, link', { timeout: 60_000 }, async () => {
  const { site, tabId } = await openSite(`${fixBase}/rec`);
  await worker.evaluate(() => {
    self.__rec = [];
    if (!self.__recListener) {
      self.__recListener = m => { if (m.type === 'showme:recorded') self.__rec.push(m.step); };
      chrome.runtime.onMessage.addListener(self.__recListener);
    }
  });
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'showme:record', on: true }), tabId);
  await site.click('#lsmall');            // label text -> radio (expect ONE step)
  await site.click('#lterms');            // label wrapping checkbox (ONE step)
  await site.click('#news');              // checkbox directly
  await site.waitForTimeout(600);         // a human does not re-toggle within the 500 ms dedupe window
  await site.click('#lnews');             // label for= checkbox (unchecks)
  await site.click('#fname'); await site.keyboard.type('Ada');
  await site.click('#go');                // blur fires change first -> type then click
  await site.click('#pw'); await site.keyboard.type('hunter2');
  await site.click('#plain');             // non-interactive: ignored; blur -> password change (must be ignored)
  await site.selectOption('#color', 'Blue');
  await site.click('#notes'); await site.keyboard.type('hello');
  await site.click('#plain');
  await site.click('#anchor');
  await site.waitForTimeout(400);
  const steps = await worker.evaluate(() => self.__rec);
  const lines = steps.map(s => `${s.action}:${s.label}${s.value ? '=' + s.value : ''}`);
  console.log('recorder:', lines);
  assert.ok(!JSON.stringify(steps).includes('hunter2'), 'password leaked into a recorded step');
  assert.deepEqual(lines.filter(l => !l.startsWith('type:Notes')), [
    'click:Small', 'click:I agree', 'click:Newsletter', 'click:Newsletter',
    'type:First name=Ada', 'click:Go', 'select:Colour=Blue', 'click:Jump',
  ]);
  // the page snapshot attached to "click Go" must show the typed name
  const go = steps.find(s => s.label === 'Go');
  assert.equal(go.page.elements.find(e => e.label === 'First name').value, 'Ada');
  assert.ok(lines.includes('type:Notes=hello'), 'contenteditable typing is not recorded');
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'showme:record', on: false }), tabId);
  await site.close();
});

test('qa: recorder: Enter-to-submit records a fresh page snapshot', { timeout: 30_000 }, async () => {
  const { site, tabId } = await openSite(`${fixBase}/slow/1`);
  await worker.evaluate(() => { self.__rec = []; });
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'showme:record', on: true }), tabId);
  await site.click('#name');
  await site.keyboard.type('Ada');
  await site.keyboard.press('Enter');
  await site.waitForTimeout(300);
  const steps = await worker.evaluate(() => self.__rec);
  console.log('enter-submit:', steps.map(s => `${s.action}:${s.label}:${s.page.elements.find(e => e.label === 'Name for the booking')?.value}`));
  // Typing then Enter is one "type + Enter" step; the browser's implicit submit click is not a step.
  assert.equal(steps.filter(s => s.action === 'click').length, 0, 'implicit submit click must not be recorded');
  const typed = steps.find(s => s.action === 'type');
  assert.ok(typed, 'type step recorded');
  assert.equal(typed.value, 'Ada');
  assert.equal(typed.submit, true);
  await site.close();
});

// ---- 4. snapshot --------------------------------------------------------------------
test('qa: snapshot excludes hidden, keeps aria labels and far-below elements', { timeout: 30_000 }, async () => {
  const { site, tabId } = await openSite(`${fixBase}/snap`);
  const page = await snap(tabId);
  const labels = page.elements.map(e => e.label);
  console.log('snap labels:', labels);
  for (const hidden of ['Display none', 'Visibility hidden', 'Opacity zero', 'Hidden attr', 'Link in hidden parent', 'Inside closed details']) {
    assert.ok(!labels.includes(hidden), `${hidden} should be excluded`);
  }
  for (const shown of ['Visible button', 'More', 'Close dialog', 'Email address', 'Custom radio', 'Search here', 'Far below']) {
    assert.ok(labels.includes(shown), `${shown} should be included`);
  }
  await site.close();
});

test('qa: snapshot shows only the dialog when a modal is open on a long page', { timeout: 30_000 }, async () => {
  const { site, tabId } = await openSite(`${fixBase}/modal-long`);
  const page = await snap(tabId);
  console.log('modal-long:', page.elements.length, page.elements.slice(0, 3).map(e => e.label));
  assert.deepEqual(page.elements.map(e => e.label), ['Accept all', 'Reject all']);
  await site.close();
});

test('qa: closed <dialog> does not hide the page', { timeout: 30_000 }, async () => {
  const { site, tabId } = await openSite(`${fixBase}/closed-dialog`);
  const page = await snap(tabId);
  assert.deepEqual(page.elements.map(e => e.label), ['Page button']);
  await site.close();
});

// ---- 5. errors surface in the panel --------------------------------------------------
async function withFakeProvider(mode, fn) {
  fake.mode = mode;
  process.env.MUBIT_API_KEY = 'mbt_test';
  process.env.MUBIT_BASE_URL = fakeBase;
  delete process.env.SHOWME_MOCK;
  try { return await fn(); } finally {
    delete process.env.MUBIT_API_KEY; delete process.env.MUBIT_BASE_URL; process.env.SHOWME_MOCK = '1';
  }
}

for (const [mode, expect] of [['401', /401: invalid api key/], ['prose', /not JSON/], ['ghost', /not on the page/]]) {
  test(`qa: panel surfaces provider failure (${mode})`, { timeout: 40_000 }, async () => {
    await withFakeProvider(mode, async () => {
      const { site, tabId } = await openSite(`${base}/demo/`);
      const panel = await openPanel(tabId);
      const r = await runGoal(panel, 'Book a table for two at eight', 15_000);
      const reason = await panel.textContent('#teach-reason');
      console.log(`provider ${mode}:`, r.verdict, '|', r.timeline, '| teach:', reason, '| teach visible:', await panel.isVisible('#teach'));
      if (mode === 'ghost' || mode === 'prose') {
        assert.equal(r.verdict, 'Failed'); // the agent's mistake (bad element, unusable answer): teaching is offered
      } else {
        assert.match(r.verdict, /^Error/); // infrastructure, not the agent: nothing to teach
        assert.equal(await panel.isVisible('#teach'), false);
      }
      assert.match(r.timeline + ' ' + reason, expect);
      await panel.close(); await site.close();
    });
  });
}

test('qa: backend offline: pill, run error, no hang', { timeout: 40_000 }, async () => {
  const { site, tabId } = await openSite(`${base}/demo/`);
  await worker.evaluate(() => chrome.storage.local.set({ server: 'http://127.0.0.1:1' }));
  const panel = await openPanel(tabId);
  try {
    await panel.waitForSelector('#mode.down');
    assert.equal(await panel.textContent('#mode'), 'Backend offline');
    assert.match(await panel.textContent('#memory-count'), /offline/);
    const r = await runGoal(panel, 'Book a table', 10_000);
    console.log('offline run:', r.verdict, '|', r.timeline, '| teach offered:', await panel.isVisible('#show-me'));
    assert.match(r.verdict, /^Error/);
    assert.equal(await panel.isVisible('#show-me'), false, 'offers "Show me how" when the backend is simply offline');
  } finally {
    await worker.evaluate(s => chrome.storage.local.set({ server: s }), base);
    await panel.close(); await site.close();
  }
});

// ---- 7. UX states -----------------------------------------------------------------
test('qa: mic button in headless shows a status, does not throw', { timeout: 20_000 }, async () => {
  const { site, tabId } = await openSite(`${base}/demo/`);
  const panel = await openPanel(tabId);
  const errors = [];
  panel.on('pageerror', e => errors.push(e.message));
  await panel.click('#mic');
  await panel.waitForTimeout(1500);
  const status = await panel.textContent('#mic-status');
  console.log('mic status:', JSON.stringify(status), 'hidden:', await panel.isHidden('#mic-status'), 'errors:', errors);
  assert.equal(errors.length, 0);
  assert.ok(status.length > 0);
  await panel.close(); await site.close();
});

test('qa: a mic error must not auto-run the previously typed goal', { timeout: 20_000 }, async () => {
  const { site, tabId } = await openSite(`${base}/demo/`);
  const fakeSpeech = () => {
    window.SpeechRecognition = class {
      start() { setTimeout(() => { this.onerror?.({ error: 'no-speech' }); this.onend?.(); }, 50); }
      stop() {}
    };
  };
  const panel = await openPanel(tabId, { initScript: fakeSpeech });
  await panel.fill('#goal', 'Book a table for two at eight');
  await panel.click('#mic');
  await panel.waitForTimeout(1500);
  const started = await panel.$$eval('#timeline li', l => l.length);
  console.log('mic error -> timeline items:', started, '| status:', await panel.textContent('#mic-status'));
  if (started) {
    await panel.click('#stop', { timeout: 2_000 }).catch(() => {});
    await panel.waitForSelector('#verdict:not([hidden])', { timeout: 10_000 }).catch(() => {});
  }
  assert.equal(started, 0, 'a failed voice capture started a run with the old goal');
  await panel.close(); await site.close();
});

test('qa: ledger renders real-looking (non-mock) data; dark mode screenshots', { timeout: 30_000 }, async () => {
  const calls = [];
  for (let i = 0; i < 30; i++) calls.push({ ts: new Date().toISOString(), task: 'next-action', kind: i % 3 ? 'live' : 'training', ms: 800 + i * 10, ok: true, model: 'claude-haiku-4-5', provider: 'anthropic', sessionId: 's', inTokens: 1200, outTokens: 40 });
  calls.push({ ts: new Date().toISOString(), task: 'next-action', kind: 'live', ms: 5, ok: false, model: 'claude-haiku-4-5', provider: 'anthropic', error: '401' });
  for (let i = 0; i < 5; i++) calls.push({ ts: new Date().toISOString(), task: 'done-check', kind: 'live', ms: 600, ok: true, model: 'claude-haiku-4-5', provider: 'anthropic', inTokens: 400, outTokens: 20 });
  fs.writeFileSync(path.join(dataDir, 'calls.jsonl'), calls.map(c => JSON.stringify(c)).join('\n') + '\n');

  const { site, tabId } = await openSite(`${base}/demo/`);
  const panel = await openPanel(tabId);
  await panel.setViewportSize({ width: 380, height: 800 });
  await panel.click('.tab[data-view=mubit]');
  await panel.waitForSelector('#ledger table');
  await panel.waitForSelector('#costs .compare');
  const text = (await panel.textContent('#view-mubit')).replace(/\s+/g, ' ');
  console.log('ledger:', text);
  assert.match(text, /next-action 21 10 30\/25/);
  assert.match(text, /\$1\.40/); // (1200*1 + 40*5)/1e6*1000
  assert.match(text, /\$0\.07/);
  assert.match(text, /At 50k decisions a day/);
  await panel.screenshot({ path: path.join(shots, 'qa-ledger-light.png'), fullPage: true });
  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.screenshot({ path: path.join(shots, 'qa-ledger-dark.png'), fullPage: true });
  await panel.click('.tab[data-view=agent]');
  await panel.fill('#goal', 'Book a table for two at eight');
  await panel.click('#run');
  await panel.waitForSelector('#verdict:not([hidden])', { timeout: 30_000 });
  await panel.screenshot({ path: path.join(shots, 'qa-agent-dark.png'), fullPage: true });
  fs.rmSync(path.join(dataDir, 'calls.jsonl'));
  await panel.close(); await site.close();
});

// ---- 8. state races ----------------------------------------------------------------
test('qa: pressing Run while recording a demonstration stops the recorder', { timeout: 60_000 }, async () => {
  await clearMemory();
  const { site, tabId } = await openSite(`${base}/demo/`);
  const panel = await openPanel(tabId);
  const r = await runGoal(panel, 'Book a table for two at eight');
  assert.equal(r.verdict, 'Failed');
  await panel.click('#show-me');
  await site.waitForSelector('#showme-recording-badge', { timeout: 10_000 });
  await panel.click('#run'); // user changes their mind and runs again
  await panel.waitForSelector('#verdict:not([hidden])', { timeout: 30_000 });
  const badge = await site.$('#showme-recording-badge');
  console.log('run-while-recording: badge still on page =', !!badge);
  assert.equal(badge, null, 'recorder badge still on (recording keeps going during the agent run)');
  await panel.close(); await site.close();
});

test('qa: double-clicking "Done teaching" saves one lesson, not two', { timeout: 60_000 }, async () => {
  await clearMemory();
  const { site, tabId } = await openSite(`${base}/demo/`);
  const panel = await openPanel(tabId);
  await runGoal(panel, 'Book a table for two at eight');
  await panel.click('#show-me');
  await site.waitForSelector('#showme-recording-badge', { timeout: 10_000 });
  await site.click('#no-thanks');
  await panel.waitForFunction(() => document.querySelectorAll('#recorded li').length >= 1);
  await panel.dblclick('#done-teaching');
  await panel.waitForTimeout(1000);
  const { demos } = await (await fetch(`${base}/api/demonstrations`)).json();
  console.log('double-click done-teaching -> lessons saved:', demos.length);
  assert.equal(demos.length, 1);
  await panel.close(); await site.close();
});

test('qa: Run on a tab that no longer exists does not leave Run disabled forever', { timeout: 20_000 }, async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=987654`);
  await panel.fill('#goal', 'anything');
  await panel.click('#run');
  await panel.waitForTimeout(1500);
  const enabled = await panel.isEnabled('#run');
  console.log('closed tab: run enabled =', enabled, '| timeline:', await panel.textContent('#timeline'));
  assert.equal(enabled, true);
  await panel.close();
});
