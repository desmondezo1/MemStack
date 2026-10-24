// Live check: the real extension, in a real (visible) browser, on real websites, with the
// real model through Mubit. Not part of `npm test`: live sites change, so this reports
// what happened (verdict, steps, final page, screenshots) instead of strict pass/fail.
// Read-only goals only: nothing is booked, bought, submitted or signed up for.
//
//   npm start                      # in another terminal, with a Mubit key in .env
//   npm run live                   # all scenarios
//   npm run live -- wikipedia      # just the ones whose name matches

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const OUT = path.join(root, 'test-results', 'live');
const SERVER = process.env.SHOWME_SERVER || 'http://localhost:8787';
const only = process.argv[2];

const SCENARIOS = [
  { name: 'youtube-play', start: 'chrome://newtab/', goal: 'Open YouTube and play a Burna Boy video',
    expect: 'a Burna Boy video page is playing (cookie banner handled first)' },
  { name: 'wikipedia-question', start: 'chrome://newtab/', goal: 'When was Burna Boy born?',
    expect: 'his Wikipedia page, with the birth date highlighted' },
  { name: 'weather', start: 'chrome://newtab/', goal: "What's the weather in London tomorrow?",
    expect: "a weather site's London page, with tomorrow's forecast highlighted (Google may block automated searches: it should go elsewhere, not try to get past it)" },
  { name: 'wikipedia-teach', start: 'https://en.wikipedia.org/wiki/Main_Page', goal: 'Where was Burna Boy born?',
    expect: 'teaching with a detour: the detour is suggested for removal, and the rerun highlights the answer', teach: teachWikipedia },
];

// The human part of the teaching scenario: search, wander off to another article and
// come back (the detour), then select the answer.
const say = msg => process.env.LIVE_DEBUG && console.log(`    … ${msg}`);

async function teachWikipedia(page) {
  await page.waitForTimeout(4500); // so the next page change counts as "typed in the address bar"
  const search = page.locator('input[name="search"]:visible').first();
  say('searching');
  await search.fill('Burna Boy');
  await search.press('Enter');
  await page.waitForURL(/Burna_Boy/, { timeout: 20000 });
  await page.waitForSelector('#showme-recording-badge', { timeout: 10000 });
  say('detour click');
  await page.locator('.infobox a[href$="/wiki/Afrobeats"]').filter({ visible: true }).first().click(); // the detour
  await page.waitForURL(/Afrobeats/);
  await page.goBack();
  await page.waitForURL(/Burna_Boy/);
  await page.waitForSelector('#showme-recording-badge', { timeout: 10000 });
  say('selecting the answer');
  // Select the birthplace text, as a person dragging over it would.
  await page.evaluate(() => {
    const place = document.querySelector('.infobox .birthplace');
    place.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.selectNodeContents(place);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    place.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
}

async function main() {
  const health = await fetch(`${SERVER}/api/health`).then(r => r.json()).catch(() => null);
  if (!health?.viaMubit) {
    console.error(`The server at ${SERVER} is ${health ? 'in practice mode' : 'not running'}. Start it with a Mubit key: npm start`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const ledgerBefore = (await fetch(`${SERVER}/api/ledger`).then(r => r.json())).totals;

  const ext = path.join(root, 'extension');
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'showme-live-')), {
    channel: 'chromium', headless: false, viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;
  await worker.evaluate(s => chrome.storage.local.set({ server: s, speak: false }), SERVER);

  const results = [];
  for (const sc of SCENARIOS.filter(s => !only || s.name.includes(only))) {
    console.log(`\n▶ ${sc.name}: ${sc.goal}`);
    const result = { name: sc.name, goal: sc.goal, expect: sc.expect };
    try {
      Object.assign(result, await runScenario(context, worker, extId, sc));
    } catch (err) {
      result.error = process.env.LIVE_DEBUG ? err.message : err.message.split('\n')[0];
    }
    console.log(`  verdict: ${result.verdict ?? '—'}${result.error ? `  (error: ${result.error})` : ''}`);
    for (const s of result.steps || []) console.log(`   · ${s}`);
    if (result.final) console.log(`  ended on: ${result.final}`);
    results.push(result);
  }
  await context.close();

  const ledgerAfter = (await fetch(`${SERVER}/api/ledger`).then(r => r.json())).totals;
  const spent = { calls: ledgerAfter.callsViaMubit - ledgerBefore.callsViaMubit, usd: ledgerAfter.providerUsd - ledgerBefore.providerUsd };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), model: health.model, spent, results }, null, 2));
  console.log(`\n${spent.calls} calls through Mubit, $${spent.usd.toFixed(4)}. Report and screenshots: ${path.relative(root, OUT)}/`);
}

async function runScenario(context, worker, extId, sc) {
  const site = await context.newPage();
  await site.goto(sc.start);
  const tabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(t => ({ id: t.id, url: t.url })));
  const tabId = tabs.filter(t => t.url.startsWith(sc.start.replace(/\/$/, ''))).pop()?.id;
  if (!tabId) throw new Error('could not find the scenario tab');

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 860 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await panel.waitForSelector('#mode.live', { timeout: 10000 });
  await site.bringToFront();

  const out = {};
  const runGoal = async label => {
    await panel.fill('#goal', sc.goal);
    await panel.click('#run');
    await panel.waitForSelector('#verdict', { state: 'hidden' }).catch(() => {});
    await panel.waitForSelector('#verdict:not([hidden])', { timeout: 180000 });
    await site.waitForTimeout(1500);
    out[`${label}Verdict`] = await panel.textContent('#verdict');
    out[`${label}Steps`] = await panel.$$eval('#timeline li', l => l.map(li => li.innerText.replace(/\s+/g, ' ').trim()));
    await site.screenshot({ path: path.join(OUT, `${sc.name}-${label}-page.png`) }).catch(() => {});
    await panel.screenshot({ path: path.join(OUT, `${sc.name}-${label}-panel.png`), fullPage: true });
  };

  await runGoal('run');
  out.verdict = out.runVerdict;
  out.steps = out.runSteps;

  if (sc.teach) {
    // Teach even if it got there alone: this scenario checks recording and clean-up on a real site.
    await panel.evaluate(() => { document.getElementById('teach').hidden = false; document.getElementById('teach-ask').hidden = false; });
    say('show me');
    await panel.click('#show-me');
    await panel.waitForSelector('#teach-recording:not([hidden])');
    await site.bringToFront();
    say('human steps');
    await sc.teach(site);
    await panel.waitForFunction(() => /point out/.test(document.querySelector('#recorded').textContent), null, { timeout: 15000 });
    out.recorded = await panel.$$eval('#recorded li .what-text', l => l.map(li => li.textContent));
    say('done');
    await panel.click('#done-teaching');
    await panel.waitForFunction(() => !document.querySelector('#teach-review').hidden || /Learned|Could not/.test(document.querySelector('#saved-summary').textContent), null, { timeout: 60000 });
    if (!(await panel.isHidden('#teach-review'))) {
      out.review = await panel.$$eval('#review li', l => l.map(li => `${li.querySelector('input').checked ? 'keep' : 'drop'}: ${li.innerText.replace(/\s+/g, ' ').trim()}`));
      await panel.screenshot({ path: path.join(OUT, `${sc.name}-review-panel.png`), fullPage: true });
      await panel.click('#save-lesson');
    }
    await panel.waitForFunction(() => /Learned|Could not/.test(document.querySelector('#saved-summary').textContent), null, { timeout: 90000 });
    out.saved = await panel.textContent('#saved-summary');
    await panel.click('#rerun');
    await runGoal('rerun');
    out.verdict = `${out.runVerdict} → after teaching: ${out.rerunVerdict}`;
    out.steps = [...out.runSteps, '— after teaching —', ...out.rerunSteps];
  }
  out.final = site.url();
  out.answerShown = await site.evaluate(() => document.querySelector('showme-overlay')?.dataset.answer || null).catch(() => null);
  await panel.close();
  await site.close();
  return out;
}

main();
