// Mo Guard end to end: the real extension in Chromium on the demo chat and the practice
// phishing page (both on *.localhost, so nothing leaves the machine). Practice mode: the
// rule-based answers stand in for Claude. The guard's own layer is a closed shadow root,
// so these tests use real clicks and the keyboard, as a person would.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showme-guard-'));
process.env.SHOWME_DATA_DIR = dataDir;
process.env.SHOWME_MOCK = '1';
process.env.MUBIT_API_KEY = '';

const { createServer } = await import('../server/index.js');
let server, port, base, context, worker, extId;

before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, r));
  port = server.address().port;
  base = `http://localhost:${port}`;
  const ext = path.join(root, 'extension');
  context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'showme-profile-')), {
    channel: 'chromium', headless: process.env.HEADED !== '1', viewport: { width: 1100, height: 760 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extId = new URL(worker.url()).host;
  await worker.evaluate(s => chrome.storage.local.set({ server: s, guardOn: true }), base);
  // "Take me to the real PayPal" must not reach the internet in tests.
  await context.route('https://www.paypal.com/**', r => r.fulfill({ contentType: 'text/html', body: '<title>Real PayPal (stub)</title><h1>stub</h1>' }));
});

after(async () => {
  await context?.close();
  server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const guardData = page => page.evaluate(() => ({ ...document.querySelector('showme-guard')?.dataset }));
const moData = page => page.evaluate(() => ({ ...document.querySelector('showme-mo')?.dataset }));

test('demo chat: risky links get labels, real ones don\'t, and Mo reacts', { timeout: 60_000 }, async () => {
  const page = await context.newPage();
  await page.goto(`${base}/demo/guard/`);
  await page.waitForFunction(() => +(document.querySelector('showme-guard')?.dataset.flags || 0) >= 3, null, { timeout: 15_000 });
  const flags = +(await guardData(page)).flags;
  assert.ok(flags >= 3 && flags <= 4, `flagged the fake PayPal, Netflix and IP links (got ${flags})`);
  // Real links keep their normal look; risky ones get a dashed outline.
  const outlines = await page.$$eval('a', as => as.map(a => [a.textContent.trim(), a.style.outlineStyle]));
  console.log('outlines:', outlines);
  assert.equal(outlines.find(([t]) => t === 'paypal.com')[1], '');
  assert.equal(outlines.find(([t]) => t === 'paypal.com/verify-account')[1], 'dashed');
  assert.equal(outlines.find(([t]) => /refresher|this on phishing/.test(t))?.[1] || '', '');
  await page.waitForFunction(() => document.querySelector('showme-mo')?.dataset.state === 'suspicious', null, { timeout: 5000 });
  assert.match((await moData(page)).bubble || '', /PayPal|suspicious/);
  await page.screenshot({ path: path.join(root, 'test-results', 'guard-chat.png') });
  await page.close();
});

test('clicking a phishing link is stopped with a warning; "Stay here" keeps you safe', { timeout: 60_000 }, async () => {
  const page = await context.newPage();
  await page.goto(`${base}/demo/guard/`);
  await page.waitForFunction(() => +(document.querySelector('showme-guard')?.dataset.flags || 0) >= 3, null, { timeout: 15_000 });
  const before = page.url();
  await page.click('text=paypal.com/verify-account');
  await page.waitForFunction(() => document.querySelector('showme-guard')?.dataset.wall === 'link');
  assert.equal(page.url(), before, 'did not navigate');
  await page.screenshot({ path: path.join(root, 'test-results', 'guard-link-wall.png') });
  // Buttons: [Take me to the real PayPal] [Stay here] [Open it anyway]. Focus starts on the first.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('showme-guard')?.dataset.wall);
  assert.equal(page.url(), before);
  await page.close();
});

test('"It\'s fine" on a label removes it, remembers the site and teaches Mubit', { timeout: 60_000 }, async () => {
  const page = await context.newPage();
  await page.goto(`${base}/demo/guard/`);
  await page.waitForFunction(() => +(document.querySelector('showme-guard')?.dataset.flags || 0) >= 3, null, { timeout: 15_000 });
  await page.waitForTimeout(2000); // labels pop in one by one: let the reveal finish
  const n = +(await guardData(page)).flags;
  const link = await page.locator('text=Microsoft 365 login').boundingBox();
  await page.mouse.click(link.x + link.width + 30, link.y + link.height / 2); // the label sits just right of the link
  await page.waitForFunction(() => document.querySelector('showme-guard')?.dataset.pop === 'open');
  await page.keyboard.press('Enter'); // "It's fine" has focus
  await page.waitForFunction(k => +(document.querySelector('showme-guard')?.dataset.flags || 0) === k - 1, n);
  const overview = await (await fetch(`${base}/api/overview`)).json();
  assert.equal(overview.guard.corrections, 1);
  assert.ok(overview.calls.some(c => c.task === 'link-check' && c.kind === 'training'));
  await page.close();
});

test('opening a fake login page shows the full-screen warning; "Take me to the real PayPal" goes there', { timeout: 60_000 }, async () => {
  const page = await context.newPage();
  await page.goto(`http://paypal-com-login.localhost:${port}/demo/guard/login.html?brand=PayPal`);
  await page.waitForFunction(() => document.querySelector('showme-guard')?.dataset.wall === 'page', null, { timeout: 15_000 });
  assert.equal((await guardData(page)).page, 'phishing');
  await page.waitForTimeout(700); // let the warning finish fading in
  await page.screenshot({ path: path.join(root, 'test-results', 'guard-page-wall.png') });
  await page.keyboard.press('Enter'); // "Take me to the real PayPal"
  await page.waitForURL('https://www.paypal.com/**');
  await page.close();
});

test('Mo Guard can be switched off from storage (Mo\'s menu) and the Mubit tab shows its numbers', { timeout: 60_000 }, async () => {
  await worker.evaluate(() => chrome.storage.local.set({ guardOn: false }));
  const page = await context.newPage();
  await page.goto(`${base}/demo/guard/?off`);
  await page.waitForTimeout(2500);
  assert.equal(+((await guardData(page)).flags || 0), 0, 'nothing flagged while off');
  await worker.evaluate(() => chrome.storage.local.set({ guardOn: true }));
  await page.waitForFunction(() => +(document.querySelector('showme-guard')?.dataset.flags || 0) >= 2, null, { timeout: 15_000 });

  const tabId = await worker.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url === u)?.id, `${base}/demo/guard/?off`);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await panel.click('.tab[data-view=mubit]');
  await panel.waitForFunction(() => /Checked \d+ links/.test(document.querySelector('#guard-stats')?.textContent || ''));
  await panel.close(); await page.close();
});
