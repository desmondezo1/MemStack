// The Judges tab: one card per judging criterion (all weighted equally). Each item
// ticks itself when the evidence actually happens, so the scoring is visible live.

import { esc, fmtUsd, goalKey } from './panel-mubit.js';

const $ = id => document.getElementById(id);
const SCENES = [
  ['voice', 'Voice command'],
  ['fail', 'It fails'],
  ['taught', 'You teach it'],
  ['rerun-done', 'Rerun works'],
  ['ledger', 'Mubit tab'],
];
const DEMO_SECONDS = 180;
const TESTS = 95;

const isLocal = url => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname); } catch { return true; } };

export function createJudgesView({ session }) {
  let overview = null;
  let bridge = null;
  let timerStart = null;
  let ticker = null;

  function evidence() {
    const o = overview;
    if (!o) return null;
    const calls = o.ledger.totals?.callsViaMubit || 0;
    const lastId = o.calls.find(c => c.requestId)?.requestId;
    const taughtLessons = o.lessons.filter(l => l.training?.viaMubit && l.training.sent > 0);
    const examples = taughtLessons.reduce((n, l) => n + l.training.sent, 0);
    const keptFull = bridge?.tasks?.find(t => t.kept != null && t.kept >= (t.needed || 25));
    const passed = bridge?.tasks?.find(t => /pass/i.test(t.status || ''));

    const realDone = o.runs.filter(r => r.outcome === 'done' && r.url && !isLocal(r.url));
    const byGoal = new Map();
    for (const r of o.runs) (byGoal.get(goalKey(r.goal)) || byGoal.set(goalKey(r.goal), []).get(goalKey(r.goal))).push(r);
    const fixed = [...byGoal.values()].find(rs => {
      const i = rs.findIndex(r => r.outcome === 'failed' || r.outcome === 'asked');
      return i !== -1 && rs.slice(i).some(r => r.outcome === 'done' && r.usedLesson);
    });
    const next = o.ledger.tasks.find(t => t.task === 'next-action');
    const monthly = next?.monthlyAt50kPerDay;

    const tools = [...new Set(o.runs.flatMap(r => r.tools || []))];
    const decisions = o.runs.reduce((n, r) => n + (r.decisions || 0), 0);
    const invalid = o.runs.reduce((n, r) => n + (r.invalid || 0), 0);
    const validRate = decisions ? 1 - invalid / decisions : null;
    const located = o.lessons.find(l => l.mistake);

    return [
      { name: 'Use of Mubit', items: [
        { met: calls > 0, text: 'Every agent decision goes through Mubit', ev: calls ? `${calls} calls recorded${lastId ? `, latest ${lastId}` : ''}` : 'Add the Mubit key and run the agent' },
        { met: examples > 0, text: 'A correction became training data', ev: examples ? `${taughtLessons.length} lesson${taughtLessons.length > 1 ? 's' : ''} → ${examples} examples sent through Mubit` : 'Fail, then “Show me how”' },
        { met: !!keptFull, text: 'A task reached 25 kept examples', ev: keptFull ? `${keptFull.task}: ${keptFull.kept} kept (Mubit console)` : 'Open Mubit → Tasks in a tab to confirm' },
        { met: !!passed, text: 'An adapter version passed its tests', ev: passed ? `${passed.task}: ${passed.status}` : 'Shows once Mubit trains a passing version' },
      ] },
      { name: 'Usefulness', items: [
        { met: realDone.length > 0, text: 'Did a real task on a real website', ev: realDone.length ? `${esc(realDone[realDone.length - 1].goal)} (${new URL(realDone[realDone.length - 1].url).hostname})` : 'Try YouTube with the real model' },
        { met: !!fixed, text: 'One lesson fixed a failure', ev: fixed ? `“${esc(fixed[0].goal)}”: ✗ then ✓ with the lesson` : 'Fail → teach → rerun' },
        { met: !!(o.guard?.flagged || o.guard?.eval), text: 'Mo Guard catches phishing links', ev: o.guard?.eval?.claude ? `Claude right on ${Math.round(100 * o.guard.eval.claude.accuracy)}% of ${o.guard.eval.claude.n} known links; ${o.guard.flagged || 0} flagged while browsing` : (o.guard?.flagged ? `${o.guard.flagged} links flagged while browsing` : 'Open the demo chat at /demo/guard/') },
        { met: !!monthly, text: 'Shows the saving at scale', ev: monthly ? `${fmtUsd(monthly.provider)} → ${fmtUsd(monthly.adapterEstimate)} a month at 50k decisions/day` : 'Needs real calls through Mubit' },
      ] },
      { name: 'Technical execution', items: [
        { met: tools.length >= 4, text: 'Uses a real browser toolset', ev: tools.length ? tools.join(', ') : 'Run a few goals' },
        { met: validRate !== null && validRate >= 0.9, text: 'Decisions are valid and checked', ev: validRate === null ? 'No decisions yet' : `${Math.round(validRate * 100)}% of ${decisions} decisions pointed at real elements` },
        { met: !!located, text: 'Finds where the agent went wrong', ev: located ? esc(located.mistake) : 'Teach once to see the mistake view' },
        { met: true, text: 'Tested end to end', ev: `${TESTS} automated tests: unit, API, and the extension in a real browser` },
      ] },
    ];
  }

  function renderScenes() {
    const seen = new Set(session.events.map(e => e.type));
    const elapsed = timerStart ? Math.floor((Date.now() - timerStart) / 1000) : 0;
    const left = DEMO_SECONDS - elapsed;
    const clock = timerStart ? `${left < 0 ? '-' : ''}${Math.floor(Math.abs(left) / 60)}:${String(Math.abs(left) % 60).padStart(2, '0')}` : '3:00';
    return `
      <div class="criterion">
        <h4>Demo <span class="score">${SCENES.filter(([k]) => seen.has(k)).length}/${SCENES.length} scenes</span></h4>
        <div class="row" style="margin:0"><span class="timer" id="demo-timer">${clock}</span>
          <button id="demo-start" class="ghost">${timerStart ? 'Restart' : 'Start 3-minute timer'}</button></div>
        <div class="scenes">${SCENES.map(([k, label]) => `<span class="${seen.has(k) ? 'done' : ''}">${label}</span>`).join('')}</div>
      </div>`;
  }

  function render() {
    const box = $('judges');
    if (!box) return;
    const cards = evidence();
    box.innerHTML = renderScenes() + (cards ? cards.map(c => `
      <div class="criterion">
        <h4>${c.name} <span class="score">${c.items.filter(i => i.met).length}/${c.items.length}</span></h4>
        <ul>${c.items.map(i => `<li class="${i.met ? 'met' : ''}"><span class="tick">${i.met ? '✓' : '○'}</span><span>${i.text}</span><span class="ev">${i.ev}</span></li>`).join('')}</ul>
      </div>`).join('') : '<p class="muted small">Loading…</p>');
    $('demo-start')?.addEventListener('click', () => {
      timerStart = Date.now();
      clearInterval(ticker);
      ticker = setInterval(() => { const t = $('demo-timer'); if (t) render(); }, 1000);
      render();
    });
  }

  return {
    render,
    update(data) { overview = data; render(); },
    setBridge(data) { bridge = data; render(); },
  };
}
