// End-to-end tests for the full toolset: open_url from a blank tab, search with
// Enter, the mistake view after teaching, address-bar navigation in a
// demonstration, ask_human, and the live savings strip with a fake Mubit.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showme-tools-'));
process.env.SHOWME_DATA_DIR = dataDir;
process.env.SHOWME_MOCK = '1';
process.env.MUBIT_API_KEY = ''; // keep the real .env key out of these tests

const { createServer } = await import('../server/index.js');

// Fake Mubit (Anthropic shape) that asks the human for help, with token usage.
const fakeMubit = http.createServer(async (req, res) => {
  for await (const _ of req);
  res.writeHead(200, { 'content-type': 'application/json', 'x-middleware-request-id': 'mreq_fake' });
  res.end(JSON.stringify({
    content: [{ type: 'text', text: '{"action":"ask_human","element_id":"","value":"Which sitting is eight o\'clock?","reason":"Times are hidden"}' }],
    usage: { input_tokens: 1000, output_tokens: 40 },
  }));
});

let server, base, fakeBase, context, worker, extId;

before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  await new Promise(r => fakeMubit.listen(0, r));
  fakeBase = `http://localhost:${fakeMubit.address().port}`;
  const ext = path.join(root, 'extension');
  context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'showme-profile-')), {
    channel: 'chromium',
    headless: process.env.HEADED !== '1',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extId = new URL(worker.url()).host;
  await worker.evaluate(s => chrome.storage.local.set({ server: s, goal: '', speak: false }), base);
});

after(async () => {
  await context?.close();
  server?.close();
  fakeMubit.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let tabCounter = 0;
async function tabAt(url) {
  const site = await context.newPage();
  const unique = `${url}${url.includes('#') ? '' : '#'}t${++tabCounter}`;
  await site.goto(unique);
  const tabId = await worker.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url === u)?.id, unique);
  assert.ok(tabId, `tab for ${unique}`);
  return { site, tabId };
}
const blankTab = () => tabAt('about:blank');

async function panelFor(tabId, { initScript } = {}) {
  const panel = await context.newPage();
  if (initScript) await panel.addInitScript(initScript);
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await panel.waitForSelector('#mode.mock, #mode.live');
  return panel;
}

async function run(panel, goal, timeout = 30_000) {
  await panel.fill('#goal', goal);
  await panel.click('#run');
  await panel.waitForSelector('#verdict:not([hidden])', { timeout });
  return { verdict: await panel.textContent('#verdict'), timeline: (await panel.textContent('#timeline')).replace(/\s+/g, ' ') };
}

test('open_url from a blank tab, search with Enter, play the video', { timeout: 60_000 }, async () => {
  const { site, tabId } = await blankTab();
  const panel = await panelFor(tabId);
  const r = await run(panel, `open ${base}/demo/tube/ and play a Burna Boy video`);
  console.log('video run:', r.verdict, '|', r.timeline);
  assert.equal(r.verdict, 'Done ✓');
  assert.match(r.timeline, /open localhost:\d+\/demo\/tube/);
  assert.match(r.timeline, /type “Burna Boy” into “Search videos” \+ Enter/);
  assert.match(r.timeline, /Now on localhost:\d+\/demo\/tube\/results\.html\?q=Burna\+Boy/);
  assert.match(await site.textContent('#status'), /Now playing: Burna Boy/);
  await panel.close(); await site.close();
});

test('mistake view: teaching marks the step where the agent went wrong', { timeout: 60_000 }, async () => {
  const { site, tabId } = await tabAt(`${base}/demo/`);
  const panel = await panelFor(tabId);
  const r = await run(panel, 'Book a table for two at eight');
  assert.equal(r.verdict, 'Failed');

  await panel.click('#show-me');
  await site.waitForSelector('#showme-recording-badge');
  await site.click('#no-thanks');
  await site.selectOption('#party', '2');
  await site.getByLabel('Sitting C').check();
  await site.fill('#name', 'Alex');
  await site.click('button[type=submit]');
  await panel.waitForFunction(() => document.querySelectorAll('#recorded li').length >= 5);
  await panel.click('#done-teaching');
  await panel.waitForFunction(() => /Learned/.test(document.querySelector('#saved-summary').textContent));

  const mistake = await panel.textContent('#timeline li.mistake');
  console.log('mistake row:', mistake.replace(/\s+/g, ' '));
  assert.match(mistake, /Mistake at step 3: I did click “Sitting A”, you did click “Sitting C”/);
  assert.equal(await panel.$$eval('#timeline li.mistake', l => l.length), 1);
  assert.match(await panel.textContent('#saved-summary'), /Mistake at step 3/);
  await panel.close(); await site.close();
});

test('demonstration records address-bar navigation and Enter, rerun replays it', { timeout: 90_000 }, async () => {
  await fetch(`${base}/api/demonstrations`, { method: 'DELETE' });
  const { site, tabId } = await blankTab();
  const panel = await panelFor(tabId);
  const r = await run(panel, 'play a Burna Boy video');
  console.log('blank run:', r.verdict, '|', r.timeline);
  assert.equal(r.verdict, 'Asked for help');
  assert.equal(await panel.isVisible('#show-me'), true);

  await panel.click('#show-me');
  await panel.waitForSelector('#teach-recording:not([hidden])');
  await site.waitForTimeout(4500); // longer than the "explained by a click" window
  await site.goto(`${base}/demo/tube/`); // like typing the address
  await site.waitForSelector('#showme-recording-badge');
  await site.fill('input[name=q]', 'Burna Boy');
  await site.press('input[name=q]', 'Enter');
  await site.waitForURL(/results\.html/);
  await site.waitForSelector('#showme-recording-badge');
  await site.click('a.video >> nth=0');
  await site.waitForURL(/watch\.html/);
  await site.waitForSelector('#showme-recording-badge');
  await site.click('#play');
  await panel.waitForFunction(() => document.querySelectorAll('#recorded li').length >= 4);
  const recorded = await panel.$$eval('#recorded li .what-text', l => l.map(li => li.textContent));
  console.log('recorded:', recorded);
  assert.match(recorded[0], /^open localhost:\d+\/demo\/tube$/);
  assert.equal(recorded[1], 'type “Burna Boy” into “Search videos” + Enter');
  assert.match(recorded[2], /^click “▶ Burna Boy — Official Music Video/);
  assert.equal(recorded[3], 'click “▶ Play”');
  assert.equal(recorded.length, 4, 'the search submit and result click must not add extra open_url steps');

  await panel.click('#done-teaching');
  await panel.waitForFunction(() => /Learned/.test(document.querySelector('#saved-summary').textContent));
  await panel.click('#rerun');
  await panel.waitForSelector('#verdict', { state: 'hidden' });
  await panel.waitForSelector('#verdict:not([hidden])', { timeout: 40_000 });
  const timeline = (await panel.textContent('#timeline')).replace(/\s+/g, ' ');
  console.log('rerun:', await panel.textContent('#verdict'), '|', timeline);
  assert.equal(await panel.textContent('#verdict'), 'Done ✓');
  assert.match(timeline, /from lesson/);
  await panel.close(); await site.close();
});

test('ask_human with a live provider: savings strip, cost per step, help verdict', { timeout: 60_000 }, async () => {
  // Pinned to Haiku 4.5 so the expected prices below don't depend on .env.
  Object.assign(process.env, { MUBIT_API_KEY: 'mbt_test', MUBIT_BASE_URL: fakeBase, MUBIT_PROVIDER: 'anthropic', MUBIT_MODEL: 'claude-haiku-4-5' });
  delete process.env.SHOWME_MOCK;
  try {
    const { site, tabId } = await tabAt(`${base}/demo/`);
    const panel = await panelFor(tabId);
    await panel.waitForSelector('#mode.live');
    const r = await run(panel, 'Book a table for two at eight');
    console.log('live ask:', r.verdict, '|', r.timeline);
    assert.equal(r.verdict, 'Asked for help');
    assert.match(await panel.textContent('#teach-reason'), /Which sitting is eight o'clock\?/);
    assert.match(r.timeline, /ask you: “Which sitting is eight o'clock\?”/);
    assert.match(r.timeline, /\$0\.0012/); // 1000 in × $1/M + 40 out × $5/M
    const savings = (await panel.textContent('#savings')).replace(/\s+/g, ' ');
    console.log('savings:', savings);
    assert.match(savings, /This run, 1 call through Mubit/);
    assert.match(savings, /On Claude\s*\$0\.0012/);
    assert.match(savings, /On an adapter \(estimate\)\s*\$0\.0001/);
    await panel.screenshot({ path: path.join(root, 'test-results', 'tools-savings.png'), fullPage: true });

    // Mubit tab: the call appears live with its request id; the run shows under failures → improvements.
    await panel.click('.tab[data-view=mubit]');
    await panel.waitForFunction(() => /mreq_fake/.test(document.querySelector('#calls').textContent));
    const calls = (await panel.textContent('#calls')).replace(/\s+/g, ' ');
    console.log('calls:', calls.slice(0, 200));
    assert.match(calls, /next-action/);
    assert.match(calls, /ask the human: Which sitting is eight o'clock\?/);
    await panel.waitForFunction(() => /Book a table for two at eight/.test(document.querySelector('#improvements').textContent));
    assert.match(await panel.textContent('#improvements'), /✗/);
    assert.notEqual(await panel.textContent('#stat-calls'), '0');

    // Real adapter numbers replace the estimate.
    await panel.click('#real-numbers summary');
    await panel.fill('#set-ratio', '10');
    await panel.fill('#set-latency', '150');
    await panel.click('#save-real');
    await panel.waitForFunction(() => /measured in Try models/.test(document.querySelector('#costs').textContent));
    assert.match(await panel.textContent('#costs'), /p50 ~150 ms/);
    await panel.click('#clear-real');
    await panel.waitForFunction(() => /estimate/.test(document.querySelector('#costs').textContent));
    await panel.screenshot({ path: path.join(root, 'test-results', 'tools-mubit-tab.png'), fullPage: true });

    // Judges tab ticks "every decision goes through Mubit" and marks the Mubit tab scene as seen.
    await panel.click('.tab[data-view=judges]');
    await panel.waitForSelector('.criterion li.met');
    const judges = (await panel.textContent('#judges')).replace(/\s+/g, ' ');
    console.log('judges:', judges.slice(0, 300));
    assert.match(judges, /✓\s*Every agent decision goes through Mubit/);
    assert.match(judges, /○\s*A correction became training data/);
    assert.equal(await panel.$$eval('.scenes span.done', s => s.map(x => x.textContent).join(',')), 'It fails,Mubit tab');
    await panel.screenshot({ path: path.join(root, 'test-results', 'tools-judges-tab.png'), fullPage: true });
    await panel.close(); await site.close();
  } finally {
    Object.assign(process.env, { MUBIT_API_KEY: '', SHOWME_MOCK: '1' });
    delete process.env.MUBIT_BASE_URL;
    delete process.env.MUBIT_MODEL;
  }
});

const moState = site => site.evaluate(() => {
  const mo = document.querySelector('showme-mo');
  return mo ? { state: mo.dataset.state, bubble: mo.dataset.bubble || '', voice: mo.dataset.voice || '' } : null;
});

test('Mo lives on every page and shows the agent\'s state', { timeout: 60_000 }, async () => {
  await fetch(`${base}/api/demonstrations`, { method: 'DELETE' });
  const { site, tabId } = await tabAt(`${base}/demo/`);
  await site.waitForSelector('showme-mo', { state: 'attached' });
  assert.equal((await moState(site)).state, 'idle');
  // Mo is invisible to the agent: not in the page snapshot, not in the page text.
  const page = await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'showme:snapshot' }), tabId);
  assert.ok(!page.page.elements.some(e => /Mo: hold|Mo menu|Show Me/.test(e.label)));
  assert.ok(!/Listening|Talk \(/.test(page.page.text));

  const panel = await panelFor(tabId);
  const seen = new Set();
  const watch = setInterval(async () => { try { const m = await moState(site); if (m) seen.add(m.state); } catch {} }, 40);
  const r = await run(panel, 'Book a table for two at eight');
  clearInterval(watch);
  assert.equal(r.verdict, 'Failed');
  const after = await moState(site);
  console.log('mo states seen:', [...seen], 'final:', after);
  assert.ok(seen.has('thinking'), 'thinking while waiting for the model');
  assert.ok(seen.has('acting'), 'acting while clicking');
  assert.equal(after.state, 'stuck');
  assert.match(after.bubble, /show me/i);
  await panel.close(); await site.close();
});

// Fake speech for tests: says what's in window.__script while "listening", keeps going
// until stop() (like continuous recognition while the key is held).
const fakeVoice = () => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('no mic in tests'));
  window.SpeechRecognition = class {
    start() {
      this.timers = (window.__script || []).map(([ms, text, isFinal]) => setTimeout(() => {
        this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal })] });
      }, ms));
    }
    stop() { this.timers?.forEach(clearTimeout); setTimeout(() => this.onend?.(), 30); }
    abort() { this.timers?.forEach(clearTimeout); setTimeout(() => this.onend?.(), 30); }
  };
};

const voiceState = site => site.evaluate(() => document.querySelector('showme-mo')?.dataset.voice || '');

async function holdTalk(site, ms) {
  await site.bringToFront();
  await site.keyboard.down('Alt');
  await site.keyboard.down('Space');
  await site.waitForTimeout(ms);
}
async function releaseTalk(site) {
  await site.keyboard.up('Space');
  await site.keyboard.up('Alt');
}

test('hold ⌥Space to talk: waveform while held, runs on release, waveform gone after', { timeout: 60_000 }, async () => {
  const goal = `open ${base}/demo/tube/ and play a Burna Boy video`;
  const { site, tabId } = await tabAt(`${base}/demo/tube/`);
  await site.waitForSelector('showme-mo', { state: 'attached' });
  const panel = await panelFor(tabId, { initScript: fakeVoice });
  await panel.evaluate(g => { window.__script = [[200, 'open the tube site', false], [600, g, true]]; }, goal);

  await holdTalk(site, 1200);
  assert.equal(await voiceState(site), 'listening');
  assert.equal(await panel.isVisible('#wave'), true);
  await releaseTalk(site);

  await panel.waitForSelector('#verdict:not([hidden])', { timeout: 40_000 });
  assert.equal(await panel.inputValue('#goal'), goal);
  assert.equal(await panel.textContent('#verdict'), 'Done ✓');
  assert.equal(await panel.isHidden('#wave'), true);
  // The bug: the waveform must not come back after release (e.g. while Mo wanders).
  await site.waitForTimeout(1200);
  assert.notEqual(await voiceState(site), 'listening');
  await panel.close(); await site.close();
});

test('Esc while holding cancels; a quick tap only shows how to talk', { timeout: 60_000 }, async () => {
  const { site, tabId } = await tabAt(`${base}/demo/tube/`);
  await site.waitForSelector('showme-mo', { state: 'attached' });
  const panel = await panelFor(tabId, { initScript: fakeVoice });
  await panel.evaluate(() => { window.__script = [[200, 'play something', true]]; });

  await holdTalk(site, 700);
  await site.keyboard.press('Escape');
  await releaseTalk(site);
  await site.waitForTimeout(800);
  assert.equal(await panel.$$eval('#timeline li', l => l.length), 0, 'cancelled: nothing runs');
  assert.notEqual(await voiceState(site), 'listening');

  await holdTalk(site, 60);
  await releaseTalk(site);
  await site.waitForTimeout(500);
  assert.match(await site.evaluate(() => document.querySelector('showme-mo').dataset.bubble || ''), /Hold ⌥ Space/);
  assert.equal(await panel.$$eval('#timeline li', l => l.length), 0, 'a tap does not run');
  await panel.close(); await site.close();
});

test('late waveform updates from an ended session are ignored', { timeout: 30_000 }, async () => {
  const { site, tabId } = await tabAt(`${base}/demo/tube/`);
  await site.waitForSelector('showme-mo', { state: 'attached' });
  const sendVoice = m => worker.evaluate(([id, m]) => chrome.tabs.sendMessage(id, { type: 'showme:voice', ...m }), [tabId, m]);
  await sendVoice({ state: 'listening', id: 'v1', levels: [0.5], text: 'hi' });
  assert.equal(await voiceState(site), 'listening');
  await sendVoice({ state: 'heard', id: 'v1', text: 'hi' });
  await sendVoice({ state: 'listening', id: 'v1', levels: [0.5], text: 'hi' }); // arrives late
  assert.equal(await voiceState(site), 'heard');
  // And a lost "stopped" message can't leave it up: it hides by itself.
  await sendVoice({ state: 'listening', id: 'v2', levels: [0.5] });
  await site.waitForTimeout(1200);
  assert.equal(await voiceState(site), 'off');
  await site.close();
});

test('with the side panel closed, holding ⌥Space listens offscreen and Mo runs the goal', { timeout: 60_000 }, async () => {
  const goal = `open ${base}/demo/tube/ and play a Wizkid video`;
  await worker.evaluate(g => chrome.storage.local.set({ voiceTestScript: [[150, 'open the tube', false], [500, g, true]] }), goal);
  try {
    for (const p of context.pages().filter(p => p.url().includes('sidepanel.html'))) await p.close();
    const { site } = await tabAt(`${base}/demo/tube/`);
    await site.waitForSelector('showme-mo', { state: 'attached' });
    await site.waitForTimeout(300); // let the background notice the panels went away
    const panelsOpen = context.pages().filter(p => p.url().includes('sidepanel.html')).length;
    assert.equal(panelsOpen, 0, 'no side panel open');
    const seen = new Set();
    const watch = setInterval(async () => { try { seen.add(await voiceState(site)); } catch {} }, 50);
    await holdTalk(site, 1200);
    await releaseTalk(site);
    await site.waitForFunction(() => /Now playing: Wizkid/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 40_000 });
    clearInterval(watch);
    await site.waitForFunction(() => document.querySelector('showme-mo')?.dataset.state === 'success', null, { timeout: 10_000 });
    console.log('offscreen voice states:', [...seen]);
    assert.ok(seen.has('listening'), 'waveform showed while held');
    assert.equal(context.pages().filter(p => p.url().includes('sidepanel.html')).length, 0, 'the panel was not opened');
    await site.close();
  } finally {
    await worker.evaluate(() => chrome.storage.local.remove('voiceTestScript'));
  }
});

test('Mubit bridge: kept examples and adapter status from the console page reach the panel', { timeout: 60_000 }, async () => {
  // Stand-in for Mubit's Tasks page text (the real console needs a sign-in).
  const fixture = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Tasks — Middleware console</title><main>
      <h1>Tasks</h1>
      <div><p>You control a web browser for a user. You get…</p><p>Training</p><p>28 of 25 examples</p></div>
      <div><p>You check whether a browser task succeeded…</p><p>v1 passed its tests</p><p>Matched 92% of your provider model's answers on 12 test cases</p><p>35 of 25 examples</p></div>
      <div><p>Sort the support message into one category…</p><p>Collecting examples</p><p>3 of 25 examples</p></div>
    </main>`);
  });
  await new Promise(r => fixture.listen(0, r));
  try {
    const url = `http://localhost:${fixture.address().port}/console/tasks`;
    const { site, tabId } = await tabAt(url);
    await worker.evaluate(id => chrome.scripting.executeScript({ target: { tabId: id }, files: ['mubit-bridge.js'] }), tabId);
    await site.waitForFunction(() => document.documentElement.dataset.showmeBridge === '2');
    const stored = await worker.evaluate(() => chrome.storage.local.get('mubitBridge'));
    console.log('bridge:', JSON.stringify(stored.mubitBridge.tasks));
    assert.deepEqual(stored.mubitBridge.tasks.map(t => [t.task, t.kept, t.status]), [
      ['next-action', 28, 'Training'],
      ['done-check', 35, 'v1 passed its tests'],
    ]);

    const panel = await panelFor(tabId);
    // The ledger needs calls for its task rows: one mock decision is enough.
    await fetch(`${base}/api/next-action`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'x', sessionId: 'b', page: { url: 'http://x/', elements: [] } }) });
    await fetch(`${base}/api/done-check`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'x', sessionId: 'b', page: { url: 'http://x/', text: '' } }) });
    await panel.click('.tab[data-view=mubit]');
    await panel.waitForFunction(() => /28\/25/.test(document.querySelector('#ledger').textContent));
    const ledger = (await panel.textContent('#ledger')).replace(/\s+/g, ' ');
    console.log('ledger:', ledger);
    assert.match(ledger, /done-check .*35\/25 v1 passed its tests · matched 92%/);
    assert.match(await panel.textContent('#bridge-status'), /read from your Mubit console/);
    await panel.click('.tab[data-view=judges]');
    const judges = (await panel.textContent('#judges')).replace(/\s+/g, ' ');
    assert.match(judges, /✓\s*A task reached 25 kept examples/);
    assert.match(judges, /✓\s*An adapter version passed its tests/);
    await worker.evaluate(() => chrome.storage.local.remove('mubitBridge'));
    await panel.close(); await site.close();
  } finally {
    fixture.close();
  }
});

test('tabs open before the extension loaded get Mo and the page reader, without duplicates', { timeout: 60_000 }, async () => {
  const { site, tabId } = await tabAt(`${base}/demo/tube/`);
  await site.waitForSelector('showme-mo', { state: 'attached' });
  // Make this tab look like one opened before the extension was installed: no Mo, no reader, no guard.
  await worker.evaluate(id => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
    window.__showMeMo?.dispose(); window.__showMeInstalled?.dispose(); window.__showMeGuard?.dispose();
    delete window.__showMeMo; delete window.__showMeInstalled; delete window.__showMeGuard;
  } }), tabId);
  assert.equal(await site.locator('showme-mo').count(), 0);
  await assert.rejects(worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'showme:ping' }), tabId));

  const injected = await worker.evaluate(() => self.injectIntoOpenTabs());
  assert.ok(injected >= 1);
  await site.waitForSelector('showme-mo', { state: 'attached' });
  assert.deepEqual(await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'showme:ping' }), tabId), { ok: true });

  // Running it again while the copies are alive changes nothing.
  await worker.evaluate(() => self.injectIntoOpenTabs());
  await site.waitForTimeout(300);
  assert.equal(await site.locator('showme-mo').count(), 1);
  const snap = await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'showme:snapshot' }), tabId);
  assert.ok(snap.page.elements.some(e => e.label === 'Search videos'));
  await site.close();
});

test('Mo\'s eyes follow the pointer and it blinks on its own', { timeout: 40_000 }, async () => {
  const { site } = await tabAt(`${base}/demo/tube/`);
  await site.waitForSelector('showme-mo', { state: 'attached' });
  const look = async () => (await site.evaluate(() => document.querySelector('showme-mo').dataset.look || '0,0')).split(',').map(Number);
  const vp = site.viewportSize();
  await site.mouse.move(20, 20);            // far top-left of Mo (which sits bottom-right)
  await site.waitForTimeout(250);
  const [x1, y1] = await look();
  assert.ok(x1 < -1 && y1 < -1, `looks up-left, got ${x1},${y1}`);
  await site.mouse.move(vp.width - 40, vp.height - 200); // straight above Mo
  await site.waitForTimeout(250);
  const [x2, y2] = await look();
  assert.ok(Math.abs(x2) < 1 && y2 < -1, `looks up, got ${x2},${y2}`);
  // Blinks come every 2–6 s.
  await site.waitForFunction(() => +(document.querySelector('showme-mo').dataset.blinks || 0) >= 1, null, { timeout: 8000 });
  await site.close();
});

test('Mo never opens the panel by itself: right-click and the help bubble open its menu', { timeout: 30_000 }, async () => {
  const { site, tabId } = await tabAt(`${base}/demo/`);
  await site.waitForSelector('showme-mo', { state: 'attached' });
  const panels = () => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }).then(c => c.length));
  const before = await panels();
  const box = await site.evaluate(() => ({ x: innerWidth - 18 - 32, y: innerHeight - 18 - 32 }));
  // Right-click Mo: the menu opens, no panel.
  await site.mouse.click(box.x, box.y, { button: 'right' });
  await site.waitForFunction(() => document.querySelector('showme-mo').dataset.menu === 'open');
  // Escape closes it.
  await site.keyboard.press('Escape');
  await site.waitForFunction(() => !document.querySelector('showme-mo').dataset.menu);
  // Stuck: clicking the "Can you show me?" bubble opens the menu (with Teach me), not the panel.
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'showme:mo', state: 'stuck', text: 'Can you show me?' }), tabId);
  await site.waitForFunction(() => document.querySelector('showme-mo').dataset.bubble === 'Can you show me?');
  const bubbleAt = { x: box.x - 40, y: box.y - 60 };
  await site.mouse.click(bubbleAt.x, bubbleAt.y);
  await site.waitForFunction(() => document.querySelector('showme-mo').dataset.menu === 'open');
  // A plain click on Mo just hints at holding to talk.
  await site.keyboard.press('Escape');
  await site.mouse.click(box.x, box.y);
  await site.waitForFunction(() => /Hold/.test(document.querySelector('showme-mo').dataset.bubble || ''));
  assert.equal(await panels(), before, 'no side panel was opened');
  await site.close();
});

test('a new tab shows Mo\'s own page, and its box opens addresses', { timeout: 30_000 }, async () => {
  const page = await context.newPage();
  await page.goto('chrome://newtab/');
  await page.waitForSelector('showme-mo', { state: 'attached' });
  assert.match(page.url(), /^chrome-extension:\/\/.+\/newtab\.html$/);
  // The extension can still talk to Mo here (thinking, listening…).
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url === 'chrome://newtab/')?.id);
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'showme:mo', state: 'thinking' }), tabId);
  await page.waitForFunction(() => document.querySelector('showme-mo').dataset.state === 'thinking');
  // An address without "https://" still opens as a site, not a search.
  await page.fill('#q', `${base.replace('http://', '')}/demo/tube/`);
  await page.press('#q', 'Enter');
  await page.waitForURL(`${base}/demo/tube/`);
  await page.close();
});

test('a question gets its answer highlighted on the page', { timeout: 60_000 }, async () => {
  const { site, tabId } = await tabAt(`${base}/demo/`);
  await site.click('#no-thanks');
  const panel = await panelFor(tabId);
  const r = await run(panel, 'What time do they open on Sunday?');
  console.log('question:', r.verdict, '|', r.timeline);
  assert.equal(r.verdict, 'Found it ✓');
  assert.match(r.timeline, /Found it: 12:00–21:00, Sunday roast until 16:00/);
  await site.waitForFunction(() => /12:00–21:00/.test(document.querySelector('showme-overlay')?.dataset.answer || ''));
  // The answer is scrolled into view.
  await site.waitForFunction(() => { const dd = [...document.querySelectorAll('dd')].find(d => d.textContent.startsWith('12:00–21:00')); const r = dd.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: 5000 });
  assert.match(await site.evaluate(() => document.querySelector('showme-mo').dataset.bubble || ''), /12:00–21:00/);
  await panel.close(); await site.close();
});

test('teaching follows a new tab, shows each catch, drops the detour, and learns the answer', { timeout: 120_000 }, async () => {
  await fetch(`${base}/api/demonstrations`, { method: 'DELETE' });
  const goal = 'Which Burna Boy video was filmed at Wembley?';
  const { site, tabId } = await tabAt(`${base}/demo/tube/`);
  const panel = await panelFor(tabId);
  const r = await run(panel, goal);
  console.log('first try:', r.verdict, '|', r.timeline);
  assert.equal(r.verdict, 'Failed');
  assert.match(await panel.textContent('#teach-reason'), /couldn't find the answer/);

  await panel.click('#show-me');
  await panel.waitForSelector('#teach-recording:not([hidden])');
  await site.waitForTimeout(4500);
  // Open a new tab and carry on there: the recorder follows.
  const tab2 = await context.newPage();
  await tab2.bringToFront();
  await panel.waitForFunction(() => /open a new tab/.test(document.querySelector('#recorded').textContent));
  await tab2.goto(`${base}/demo/tube/`);
  await tab2.waitForSelector('#showme-recording-badge');
  await tab2.fill('input[name=q]', 'Burna Boy');
  await tab2.press('input[name=q]', 'Enter');
  await tab2.waitForURL(/results/);
  await tab2.waitForSelector('#showme-recording-badge');
  // The detour: open the first result, then come back.
  await tab2.click('a.video >> nth=0');
  await tab2.waitForURL(/watch/);
  await tab2.goBack();
  await tab2.waitForSelector('#showme-recording-badge');
  await tab2.click('a.video >> nth=1'); // "live at Wembley"
  await tab2.waitForURL(/watch/);
  await tab2.waitForSelector('#showme-recording-badge');
  // Each caught step flashes on the page.
  await tab2.click('#title', { clickCount: 3 }); // select the title: "this is the answer"
  await panel.waitForFunction(() => /point out/.test(document.querySelector('#recorded').textContent));
  const recorded = await panel.$$eval('#recorded li .what-text', l => l.map(li => li.textContent));
  console.log('recorded:', recorded);
  assert.equal(recorded[0], 'open a new tab');
  assert.match(recorded[1], /^open localhost:\d+\/demo\/tube$/);
  assert.equal(recorded[2], 'type “Burna Boy” into “Search videos” + Enter');
  assert.match(recorded[3], /Official Music Video/);
  assert.match(recorded[4], /live at Wembley/);
  assert.match(recorded.at(-1), /^point out “Burna Boy live at Wembley/);

  // Done → review: the new tab and the abandoned result are suggested for removal.
  await panel.click('#done-teaching');
  await panel.waitForSelector('#teach-review:not([hidden])');
  const review = await panel.$$eval('#review li', l => l.map(li => ({ kept: li.querySelector('input').checked, text: li.textContent })));
  console.log('review:', review.map(x => `${x.kept ? '✓' : '✗'} ${x.text}`));
  assert.equal(review[0].kept, false);
  assert.equal(review[3].kept, false);
  assert.match(review[3].text, /came back/);
  assert.ok(review.filter((_, i) => ![0, 3].includes(i)).every(x => x.kept));
  await panel.click('#save-lesson');
  await panel.waitForFunction(() => /Learned/.test(document.querySelector('#saved-summary').textContent));

  // Next time: it follows the lesson and highlights the answer.
  await tab2.close();
  await panel.click('#rerun');
  await panel.waitForSelector('#verdict', { state: 'hidden' });
  await panel.waitForSelector('#verdict:not([hidden])', { timeout: 40_000 });
  const timeline = (await panel.textContent('#timeline')).replace(/\s+/g, ' ');
  console.log('rerun:', await panel.textContent('#verdict'), '|', timeline);
  assert.equal(await panel.textContent('#verdict'), 'Found it ✓');
  assert.match(timeline, /Found it: .*Wembley/);
  assert.doesNotMatch(timeline, /Official Music Video/);
  await panel.close(); await site.close();
});
