// End-to-end: loads the real extension into Chromium, runs the agent on the demo
// site, watches it fail, teaches it by hand, and checks the rerun succeeds.
// Uses the mock model unless SHOWME_E2E_LIVE=1 (then it uses your .env Mubit key).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showme-e2e-'));
process.env.SHOWME_DATA_DIR = dataDir;
if (process.env.SHOWME_E2E_LIVE !== '1') process.env.SHOWME_MOCK = '1';
else (await import('../server/env.js')).loadEnv();

const { createServer } = await import('../server/index.js');
const GOAL = 'Book a table for two at eight';
const live = process.env.SHOWME_E2E_LIVE === '1';

let server, base, context, worker, extId;

before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  const ext = path.join(root, 'extension');
  context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'showme-profile-')), {
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
  server?.close();
  if (process.env.KEEP_DATA === "1") console.log("data kept in", dataDir);
  else fs.rmSync(dataDir, { recursive: true, force: true });
});

async function tabIdFor(url) {
  return worker.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url.startsWith(u))?.id, url);
}

test('fail, show me, rerun succeeds', { timeout: live ? 300_000 : 90_000 }, async () => {
  const site = await context.newPage();
  await site.goto(`${base}/demo/`);
  const tabId = await tabIdFor(`${base}/demo/`);
  assert.ok(tabId, 'demo tab found');

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await panel.waitForSelector('#mode.mock, #mode.live', { timeout: 10_000 });

  // 1. First run: the agent can't know which sitting is 20:00, so it fails.
  await panel.fill('#goal', GOAL);
  await panel.click('#run');
  await panel.waitForSelector('#verdict:not([hidden])', { timeout: live ? 120_000 : 30_000 });
  const firstVerdict = await panel.textContent('#verdict');
  const timeline1 = await panel.textContent('#timeline');
  console.log('first run:', firstVerdict, '|', timeline1.replace(/\s+/g, ' '));
  if (!live) {
    assert.equal(firstVerdict, 'Failed');
    assert.match(timeline1, /Sitting A/);
  }
  if (firstVerdict !== 'Failed') return; // a live model guessed right: nothing to teach

  // 2. Show me: the page reloads and the recorder starts.
  await panel.click('#show-me');
  await site.waitForSelector('#showme-recording-badge', { timeout: 10_000 });
  await site.click('#no-thanks');
  await site.selectOption('#party', '2');
  await site.getByLabel('Sitting C').check();
  await site.fill('#name', 'Alex');
  await site.click('button[type=submit]');
  await site.waitForSelector('#confirmation', { state: 'visible' });

  await panel.waitForFunction(() => document.querySelectorAll('#recorded li').length >= 5);
  const recorded = await panel.$$eval('#recorded li .what-text', lis => lis.map(li => li.textContent));
  console.log('recorded:', recorded);
  assert.deepEqual(recorded, [
    'click “No thanks”',
    'select “2” in “Party size”',
    'click “Sitting C”',
    'type “Alex” into “Name for the booking”',
    'click “Reserve table”',
  ]);

  await panel.click('#done-teaching');
  await panel.waitForFunction(() => /Learned|Could not/.test(document.querySelector('#saved-summary').textContent), null, { timeout: live ? 120_000 : 15_000 });
  const summary = await panel.textContent('#saved-summary');
  console.log('saved:', summary);
  assert.match(summary, /Learned/);
  assert.match(summary, /sent 5 training examples/);

  // 3. Rerun from a fresh page: the recalled lesson gets it right.
  await panel.click('#rerun');
  await panel.waitForSelector('#verdict', { state: 'hidden' });
  await panel.waitForSelector('#verdict:not([hidden])', { timeout: live ? 120_000 : 30_000 });
  const timeline2 = await panel.textContent('#timeline');
  console.log('rerun:', await panel.textContent('#verdict'), '|', timeline2.replace(/\s+/g, ' '));
  assert.equal(await panel.textContent('#verdict'), 'Done ✓');
  assert.match(timeline2, /from lesson/);
  assert.match(await site.textContent('#summary'), /Sitting C \(20:00\)/);

  // 4. Ledger shows live and taught calls for the next-action task.
  await panel.click('.tab[data-view=mubit]');
  await panel.waitForSelector('#ledger table');
  const ledger = await panel.textContent('#ledger');
  assert.match(ledger, /next-action/);
  assert.match(ledger, /done-check/);

  await panel.screenshot({ path: path.join(root, 'test-results', 'sidepanel-ledger.png') });
});
