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
  assert.match(r.timeline, /now on localhost:\d+\/demo\/tube\/results\.html\?q=Burna\+Boy/);
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
  const recorded = await panel.$$eval('#recorded li', l => l.map(li => li.textContent));
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
  Object.assign(process.env, { MUBIT_API_KEY: 'mbt_test', MUBIT_BASE_URL: fakeBase, MUBIT_PROVIDER: 'anthropic' });
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
    assert.match(savings, /This run · 1 calls via Mubit · \$0\.0012 on the model vs ~\$0\.0001 on an adapter/);
    assert.match(savings, /All time · \d+ calls/);
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
  assert.ok(!page.page.elements.some(e => /Show Me|Mo menu/.test(e.label)));
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

test('⌥Space: the panel listens, the waveform shows on the page, then the agent runs', { timeout: 60_000 }, async () => {
  const fakeVoice = () => {
    // No real microphone in tests: speech recognition that hears a goal, and no getUserMedia (synthetic wave).
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('no mic in tests'));
    window.SpeechRecognition = class {
      start() {
        const say = (text, isFinal) => this.onresult?.({ results: Object.assign([Object.assign([{ transcript: text }], { isFinal })], {}) });
        setTimeout(() => this.onspeechstart?.(), 100);
        setTimeout(() => say('open http://localhost', false), 400);
        setTimeout(() => say(window.__goal, true), 1200);
        setTimeout(() => this.onend?.(), 1400);
      }
      stop() { this.onend?.(); }
    };
  };
  const { site, tabId } = await tabAt('about:blank');
  const panel = await panelFor(tabId, { initScript: fakeVoice });
  await panel.evaluate(g => { window.__goal = g; }, `open ${base}/demo/tube/ and play a Burna Boy video`);
  // Load a real page so Mo is there to show the waveform.
  await site.goto(`${base}/demo/tube/#voice`);
  await site.waitForSelector('showme-mo', { state: 'attached' });

  const opened = await worker.evaluate(id => self.handleTalk({ id }), tabId);
  assert.equal(opened, false); // no window id in this test, so no real side panel opens
  await site.waitForFunction(() => document.querySelector('showme-mo')?.dataset.voice === 'listening', null, { timeout: 5000 });
  assert.equal(await panel.isVisible('#wave'), true);
  await panel.waitForSelector('#verdict:not([hidden])', { timeout: 40_000 });
  console.log('voice run:', await panel.textContent('#verdict'), '|', (await panel.textContent('#timeline')).replace(/\s+/g, ' ').slice(0, 160));
  assert.equal(await panel.inputValue('#goal'), `open ${base}/demo/tube/ and play a Burna Boy video`);
  assert.equal(await panel.textContent('#verdict'), 'Done ✓');
  assert.equal(await panel.isHidden('#wave'), true);
  await panel.close(); await site.close();
});
