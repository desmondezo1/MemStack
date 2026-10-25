// Mo's side panel: runs the agent loop against the current tab, asks for a
// demonstration when the run fails, and shows the Mubit ledger.

import { createMubitView, esc, fmtUsd, prettyModel } from './panel-mubit.js';
import { InfraError, createApi, isOwnPage, isWebPage, sleep, waitForLoad, send, snapshot, describeAction, shortUrl, runAgent, mo as moOn } from './agent-core.js';
import { createVoiceSession } from './voice-core.js';
import { createJudgesView } from './panel-judges.js';
import { parseCsv, toTable, inferRules, valuesForRow, rowGoal, describeRule, rowKey, generatedFromNote } from './sheet-core.js';

const $ = id => document.getElementById(id);
// Testing hook: sidepanel.html?tabId=123 drives that tab when opened as a normal page.
const forcedTabId = Number(new URLSearchParams(location.search).get('tabId')) || null;

const state = {
  server: 'http://localhost:8787',
  running: false,
  stopRequested: false,
  lastGoal: '',
  lastStartUrl: '',
  recording: false,
  recorded: [],
  recordTabId: null,
  runTabId: null,     // the tab the last run used; teaching and rerun stay on it
  abort: null,        // aborts the in-flight backend call when Stop is pressed
  saving: false,
  runSteps: [],       // the last run's actions with their timeline rows, for the mistake view
  lastUrl: null,      // recording: last URL seen, to catch address-bar navigation
  lastStepAt: 0,
  run: null,          // live savings for the current run
  skill: null,        // the skill this run is doing (picked by name), if any
  usedSkill: null,    // the skill whose lesson the last run followed: a correction adds to it
  teachSkill: null,   // the name a new lesson will be saved under
  sheet: null,        // sheet to form: { columns, rows, source, tabId }
  sheetTeach: false,  // the lesson being recorded is row 1 of a sheet
  sheetSkill: null,   // the saved skill a sheet run uses: { name, rules, startUrl, submit, columns }
  batch: null,        // the batch running now
  skills: [],
};

// ---- Backend ----------------------------------------------------------------

const api = createApi(async () => state.server);

async function tabById(id) {
  if (id) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (tab) return tab;
  }
  return targetTab();
}

async function refreshHealth() {
  const pill = $('mode');
  try {
    const h = await api('/api/health');
    pill.textContent = h.viaMubit ? `${prettyModel(h.model)} via Mubit` : 'Practice mode (no Mubit key)';
    pill.className = `pill ${h.viaMubit ? 'live' : 'mock'}`;
    pill.title = h.viaMubit ? `Provider: ${h.provider}. Every call is recorded by Mubit.` : 'Set MUBIT_API_KEY in .env and restart the server to use Claude via Mubit.';
  } catch {
    pill.textContent = 'Backend offline';
    pill.className = 'pill down';
    pill.title = `Start it with: npm start (expected at ${state.server})`;
  }
}

async function refreshMemory() {
  try {
    const [{ demos }, { skills }] = await Promise.all([api('/api/demonstrations'), api('/api/skills')]);
    state.skills = skills;
    const s = n => (n === 1 ? '' : 's');
    $('memory-count').textContent = demos.length ? `${skills.length} skill${s(skills.length)} from ${demos.length} lesson${s(demos.length)}` : 'No lessons yet';
    $('forget').hidden = !demos.length;
    renderSkills();
  } catch {
    $('memory-count').textContent = 'Lessons unavailable: the backend is offline';
  }
}

// My skills: what you taught Mo, each with a Run button. Lessons sit inside as its history.
function renderSkills() {
  const list = $('skill-list');
  if (!state.skills.length) { list.innerHTML = '<li class="empty">Nothing taught yet. When Mo gets something wrong, show it once.</li>'; return; }
  list.innerHTML = '';
  for (const sk of state.skills) {
    const taught = sk.lessons.length;
    const notes = sk.lessons.reduce((n, l) => n + (l.notes || 0), 0);
    const meta = [
      taught === 1 ? 'taught once' : `taught once, corrected ${taught - 1}×`,
      sk.sheet ? `from a sheet (${sk.sheet.rules.length} fields)` : '',
      notes ? `${notes} note${notes === 1 ? '' : 's'}` : '',
      sk.runs ? `ran ${sk.runs}×` : '',
    ].filter(Boolean).join(' · ');
    const li = document.createElement('li');
    li.innerHTML = `<span class="skill-name-text">${esc(sk.name)}<span class="skill-meta">${esc(meta)}</span></span>` +
      `<button class="btn quiet skill-run">Run</button><button class="skill-del" title="Forget this skill" aria-label="Forget ${esc(sk.name)}">×</button>`;
    li.querySelector('.skill-run').addEventListener('click', () => runSkill(sk));
    li.querySelector('.skill-del').addEventListener('click', async () => {
      await api('/api/skills/delete', { method: 'POST', body: { name: sk.name } }).catch(() => {});
      refreshMemory();
    });
    list.appendChild(li);
  }
}

// Run a skill: from where it was taught, following its newest lesson. A sheet skill asks for
// the rows first.
async function runSkill(sk) {
  if (state.running) return;
  if (sk.sheet) return openSheet({ name: sk.name, ...sk.sheet });
  const tab = await targetTab().catch(() => null);
  const pageOf = u => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return u; } };
  if (tab && /^https?:/.test(sk.startUrl || '') && pageOf(tab.url) !== pageOf(sk.startUrl)) await goTo(tab.id, sk.startUrl);
  $('goal').value = sk.goal;
  run(sk.goal, { skill: sk.name });
}

// ---- Tab ----------------------------------------------------------------------

// The tab to work on: the active one, unless it's one of our own pages (the mic
// permission tab, say); then the most recently used normal tab in this window.
async function targetTab() {
  if (forcedTabId) return chrome.tabs.get(forcedTabId);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && !isOwnPage(active.url)) return active;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const normal = tabs.filter(t => !isOwnPage(t.url)).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return normal[0] || active;
}

// ---- Live savings -----------------------------------------------------------
// Each call's real provider cost (tokens × price) next to what the same call would
// cost on a Mubit adapter (estimate until Try models gives real numbers).


function addUsage(usage, ms) {
  if (!state.run || !usage?.viaMubit) return;
  state.run.calls++;
  state.run.providerUsd += usage.costUsd;
  state.run.adapterUsd += usage.adapterCostUsd;
  state.run.ms += ms;
  state.run.adapterMs = usage.adapterMs;
  renderSavings();
}

let totals = null;
async function refreshTotals() {
  try { totals = (await api('/api/ledger')).totals; } catch { totals = null; }
  renderSavings();
}

// Shown once a run has made real calls: this run on Claude next to the same calls on an
// adapter. All-time totals live in the Mubit tab.
function renderSavings() {
  const box = $('savings');
  const r = state.run;
  if (!r?.calls) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `
    <span class="h">This run, ${r.calls} call${r.calls === 1 ? '' : 's'} through Mubit</span><span class="h">Cost</span><span class="h">Per decision</span>
    <span class="label">On Claude</span><span>${fmtUsd(r.providerUsd)}</span><span>${Math.round(r.ms / r.calls)} ms</span>
    <span class="label">On an adapter${totals?.adapterMeasured ? '' : ' (estimate)'}</span><span class="adapter">${fmtUsd(r.adapterUsd)}</span><span class="adapter">~${r.adapterMs} ms</span>`;
}

function speak(text) {
  if (!$('speak').checked || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function addStep(html, { error = false, kind = '' } = {}) {
  const li = document.createElement('li');
  li.innerHTML = html;
  if (error) li.classList.add('error');
  if (kind) li.classList.add(kind);
  $('timeline').appendChild(li);
  $('examples').hidden = true;
  li.scrollIntoView({ block: 'nearest' });
  return li;
}

// One step: what it did, then why, with time and cost on the right.
function stepHtml(text, { badge = '', why = '', nums = '' } = {}) {
  return `<div class="step-main"><span class="step-text">${text}${badge}</span><span class="step-nums">${nums}</span></div>` +
    (why ? `<div class="step-why">${why}</div>` : '');
}


function setVerdict(ok, text) {
  const v = $('verdict');
  v.hidden = false;
  v.className = `verdict ${ok ? 'ok' : 'bad'}`;
  v.textContent = text;
}

function resetRunUi() {
  $('timeline').innerHTML = '';
  $('verdict').hidden = true;
  $('not-right').hidden = true;
  $('run-session').hidden = true;
  $('teach').hidden = true;
  $('savings').hidden = true;
}

// ---- Agent loop -------------------------------------------------------------
// The loop itself lives in agent-core.js (shared with voice runs in the background);
// here it draws each step on the timeline.

async function run(goal, { skill = null } = {}) {
  if (state.running || !goal.trim()) return;
  state.skill = skill;
  state.usedSkill = skill;
  state.sheetTeach = false;
  $('sheet').hidden = true;
  state.running = true;
  state.stopRequested = false;
  state.abort = new AbortController();
  $('run').disabled = true;
  $('stop').hidden = false;
  if (state.recording) await stopRecording();
  resetRunUi();

  const tab = await targetTab().catch(() => null);
  let r;
  if (!tab) {
    r = { failure: 'No tab to work on', infra: true, outcome: 'error', usedLesson: false, asked: false };
    addStep(stepHtml('No tab to work on'), { error: true, kind: 'note' });
  } else {
    state.runTabId = tab.id;
    state.lastGoal = goal;
    state.lastStartUrl = tab.url;
    state.runSteps = [];
    state.run = { calls: 0, providerUsd: 0, adapterUsd: 0, ms: 0, adapterMs: null };
    renderSavings();
    r = await runAgent({
      goal, tabId: tab.id, api, signal: state.abort.signal, isStopped: () => state.stopRequested, skill,
      ui: {
        usage: addUsage,
        step: next => {
          if (next.demoUsed?.skill) state.usedSkill = next.demoUsed.skill;
          const lesson = next.demoUsed ? '<span class="badge lesson">from lesson</span>' : '';
          const cost = next.usage?.viaMubit ? fmtUsd(next.usage.costUsd) : '';
          const time = next.ms >= 100 ? `${(next.ms / 1000).toFixed(1)} s` : '';
          return addStep(stepHtml(esc(describeAction(next)), { badge: lesson, why: next.reason ? `<span class="why-text">${esc(next.reason)}</span>` : '', nums: [time, cost].filter(Boolean).join(', ') }), { error: !next.valid });
        },
        failedStep: li => li?.classList.add('error'),
        navigated: (li, url) => {
          if (!li) return;
          const why = li.querySelector('.step-why') || li.appendChild(Object.assign(document.createElement('div'), { className: 'step-why' }));
          why.insertAdjacentHTML('beforeend', `<span class="went">${why.textContent ? '. ' : ''}Now on ${esc(shortUrl(url))}</span>`);
        },
        answer: found => addStep(stepHtml(`Found it: <span class="answer-text">${esc(found.answer)}</span>`, { why: 'Highlighted on the page', badge: found.demoUsed ? '<span class="badge lesson">from lesson</span>' : '' }), { kind: 'check' }),
        check: check => addStep(stepHtml(check.done ? 'Checked: goal met' : 'Checked: goal not met', { why: esc(check.reason), nums: check.ms >= 100 ? `${(check.ms / 1000).toFixed(1)} s` : '' }), { error: !check.done, kind: 'check' }),
        error: message => addStep(stepHtml(esc(message)), { error: true, kind: 'note' }),
      },
    });
    state.runSteps = r.runSteps.map(step => ({ ...step, li: step.handle }));
  }
  state.running = false;
  state.abort = null;
  $('run').disabled = false;
  $('stop').hidden = true;

  refreshTotals();
  const { failure, infra, asked, usedLesson, outcome } = r;
  if (r.sessionId && $('mode').classList.contains('live')) {
    $('run-session').hidden = false;
    $('run-session').innerHTML = `In Mubit: filter Requests by session <button class="copy" data-copy="${esc(r.sessionId)}">${esc(r.sessionId)}</button> to see every decision from this run.`;
  }
  note(outcome === 'done' ? (usedLesson ? 'rerun-done' : 'done') : outcome === 'failed' || outcome === 'asked' ? 'fail' : outcome);
  if (failure && infra) mo('idle', { text: 'Something went wrong. Check Mo\'s panel.', hold: 5000 });
  if (failure) {
    setVerdict(false, failure === 'Stopped.' ? 'Stopped' : infra ? 'Error — not the agent\'s fault, so nothing to teach' : asked ? 'Asked for help' : 'Failed');
    if (failure !== 'Stopped.' && !infra) {
      offerTeaching(failure);
      mo('stuck', { text: asked ? `I need help: ${failure.replace(/^I need help: /, '')}` : 'I couldn\'t finish this. Can you show me?' });
      speak(asked ? `I need help. ${failure.replace(/^I need help: /, '')}. Can you show me?` : 'I couldn\'t finish this. Can you show me how?');
    }
  } else if (r.answer) {
    setVerdict(true, 'Found it ✓');
    mo('success', { text: r.answer, hold: 10000 });
    speak(r.answer);
  } else {
    setVerdict(true, 'Done ✓');
    $('not-right').hidden = false;
    mo('success', { text: usedLesson ? 'Done, using what you taught me!' : 'Done!' });
    speak('Done.');
  }
}

// ---- Teaching ("show me") -----------------------------------------------------

// title: why we're asking. A finished run can still be wrong for you (a paid add-on left
// on, the wrong end date): "Not what you wanted?" teaches your way the same as a failure.
function offerTeaching(reason, title = 'I couldn\'t finish this') {
  $('teach-title').textContent = title;
  $('not-right').hidden = true;
  $('teach').hidden = false;
  $('teach-ask').hidden = false;
  $('teach-recording').hidden = true;
  $('teach-review').hidden = true;
  $('teach-saved').hidden = true;
  $('teach-reason').textContent = reason;
}

async function goTo(tabId, url) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (url && tab.url !== url) await chrome.tabs.update(tabId, { url });
    else if (isWebPage(tab.url)) await chrome.tabs.reload(tabId);
  } catch { /* some browser pages can't be reopened by an extension: stay where we are */ }
  await sleep(300);
  return waitForLoad(tabId);
}

async function startTeaching() {
  const tab = await tabById(state.runTabId);
  // Start the demonstration from the page the run started on.
  const page = await goTo(tab.id, state.lastStartUrl);
  state.recording = true;
  state.recorded = [];
  state.recordTabId = tab.id;
  $('saved-summary').textContent = '';
  state.lastUrl = page.url;
  state.lastStepAt = Date.now();
  $('recorded').innerHTML = '';
  $('skill-name').value = state.teachSkill || state.usedSkill || state.lastGoal;
  $('done-teaching').disabled = true;
  $('teach-ask').hidden = true;
  $('teach-recording').hidden = false;
  if (isWebPage(page.url)) await send(tab.id, { type: 'showme:record', on: true });
  mo('idle', { text: 'I\'m watching. Show me how.', hold: 5000 }, tab.id);
}

// Steps that can move the page on; a URL change right after one of these was caused by it.
const NAV_CAUSES = new Set(['click', 'type', 'select', 'press', 'open_url']);
const STEP_ICON = { click: '↖', type: 'T', select: '▾', press: '⏎', highlight: '★', open_url: '↗', new_tab: '+', switch_tab: '⇄' };
const siteOf = st => { try { return new URL(st.action === 'open_url' || st.action === 'switch_tab' ? st.value : st.page?.url).hostname.replace(/^www\./, ''); } catch { return ''; } };

function onRecorded(step) {
  if (!state.recording) return;
  if (NAV_CAUSES.has(step.action)) state.lastStepAt = Date.now();
  state.recorded.push(step);
  renderRecorded(true);
}

function renderRecorded(flashLast = false) {
  const list = $('recorded');
  list.innerHTML = '';
  state.recorded.forEach((st, i) => {
    const li = document.createElement('li');
    const kind = st.action === 'highlight' ? 'highlight' : st.action === 'new_tab' || st.action === 'switch_tab' ? 'tab' : '';
    li.innerHTML = `<span class="kind ${kind}" aria-hidden="true">${STEP_ICON[st.action] || '•'}</span>` +
      `<span class="what"><span class="what-text">${esc(describeAction(st))}</span><span class="where">${esc(siteOf(st))}</span></span>` +
      `<button class="note-btn${st.note ? ' has' : ''}" title="Add a note for Mo" aria-label="Add a note to step ${i + 1}">✎</button>` +
      `<button class="remove" title="Remove this step" aria-label="Remove step ${i + 1}">×</button>` +
      (st.note ? `<p class="step-note">Note: ${esc(st.note)}</p>` : '');
    li.querySelector('.remove').addEventListener('click', () => { state.recorded.splice(i, 1); renderRecorded(); });
    // A note says what the steps can't: where a value comes from, or how to choose it.
    li.querySelector('.note-btn').addEventListener('click', () => {
      if (li.querySelector('.note-input')) return;
      li.querySelector('.step-note')?.remove();
      const input = Object.assign(document.createElement('input'), { type: 'text', className: 'note-input', value: st.note || '', placeholder: 'e.g. a random weekday in the next 2 weeks; not in the sheet' });
      const save = () => { st.note = input.value.trim().slice(0, 300); renderRecorded(); };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') renderRecorded(); });
      input.addEventListener('blur', save);
      li.appendChild(input);
      input.focus();
    });
    if (flashLast && i === state.recorded.length - 1) li.classList.add('new');
    list.appendChild(li);
  });
  list.lastElementChild?.scrollIntoView({ block: 'nearest' });
  $('done-teaching').disabled = !state.recorded.length;
}

async function stopRecording() {
  state.recording = false;
  if (state.recordTabId) await send(state.recordTabId, { type: 'showme:record', on: false }).catch(() => {});
}

// Done: first check the lesson for detours (rules, then the model through Mubit). If any
// steps look unneeded, you review them; otherwise it's saved straight away.
async function finishTeaching() {
  if (state.saving || !state.recording || !state.recorded.length) return;
  state.saving = true;
  $('done-teaching').disabled = true;
  await stopRecording();
  const steps = state.recorded;
  $('teach-recording').hidden = true;
  $('teach-saved').hidden = false;
  $('saved-summary').textContent = 'Checking your lesson for detours…';
  $('rerun').disabled = true;
  const lite = st => ({ action: st.action, label: st.label, role: st.role, value: st.value, submit: st.submit, led_to: st.led_to, note: st.note, page: { url: st.page?.url } });
  // The detour check is a nice-to-have: if it doesn't answer within 8 s, save the lesson as it is.
  const review = await Promise.race([
    api('/api/refine-lesson', { method: 'POST', body: { goal: state.lastGoal, steps: steps.map(lite) } }).catch(() => null),
    sleep(8000).then(() => null),
  ]);
  state.saving = false;
  if (review && review.keep.some(k => !k)) return showReview(steps, review);
  await saveLesson(steps);
}

function showReview(steps, review) {
  $('teach-recording').hidden = true;
  $('teach-saved').hidden = true;
  $('teach-review').hidden = false;
  const list = $('review');
  list.innerHTML = '';
  steps.forEach((st, i) => {
    const li = document.createElement('li');
    const keep = review.keep[i];
    li.classList.toggle('dropped', !keep);
    li.innerHTML = `<label><input type="checkbox" ${keep ? 'checked' : ''}><span class="what">${esc(describeAction(st))}` +
      `${keep ? '' : `<span class="reason">${esc(review.why[i] || 'Looks unneeded')}</span>`}</span></label>`;
    li.querySelector('input').addEventListener('change', e => li.classList.toggle('dropped', !e.target.checked));
    list.appendChild(li);
  });
  $('save-lesson').onclick = () => {
    const kept = steps.filter((_, i) => list.children[i].querySelector('input').checked);
    if (kept.length) saveLesson(kept);
  };
}

async function saveLesson(steps) {
  if (state.saving) return;
  state.saving = true;
  $('teach-recording').hidden = true;
  $('teach-review').hidden = true;
  $('teach-saved').hidden = false;
  $('saved-summary').textContent = `Saving ${steps.length} steps and sending them through Mubit…`;
  $('rerun').disabled = true;
  try {
    const mistake = markMistake(state.runSteps, steps);
    const skill = $('skill-name').value.trim() || state.teachSkill || state.lastGoal;
    const sheet = state.sheetTeach ? sheetFromLesson(steps) : null;
    // A sheet lesson's goal lists the values of the row you did, the way each later row's goal will.
    const goal = sheet ? rowGoal(skill, 1, state.sheet.rows.length, sheet.rules.map(r => ({ label: r.label, value: r.value }))) : state.lastGoal;
    const { training, demo } = await api('/api/demonstrations', {
      method: 'POST', body: { goal, url: steps[0].page.url, steps, mistake, skill, sheet },
    });
    state.teachSkill = null;
    if (sheet) {
      state.sheetTeach = false;
      state.sheetSkill = { name: skill, ...sheet };
      await markRowsDone(skill, [state.sheet.rows[0]]);
      await showSheetReview();
      $('sheet-learned').hidden = false;
      $('sheet-learned').innerHTML = `<b>Learned “${esc(skill)}”.</b> Row 1 is done; its ${training.sent} steps went to ${training.viaMubit ? 'Mubit as training examples' : 'the mock model (no Mubit key)'}.` +
        (training.viaMubit && demo?.id ? ` Filter Requests by session <button class="copy" data-copy="demo-${esc(demo.id)}">demo-${esc(demo.id)}</button>.` : '');
    }
    note('taught');
    mo('learning', { count: training.sent, text: training.viaMubit ? `+${training.sent} training examples → Mubit` : `Saved ${steps.length} steps (mock: not sent)` }, state.recordTabId);
    const where = training.viaMubit ? 'through Mubit' : 'to the mock model (no Mubit key, so nothing was recorded)';
    $('saved-summary').innerHTML =
      (mistake ? `<span class="mistake-inline">${esc(mistake)}</span>` : '') +
      `<b>Learned.</b> Saved ${steps.length} steps to memory and sent ${training.sent} training examples ${where}` +
      ` (the model matched your demonstration on ${training.agreed}/${steps.length}).` +
      (training.errors ? ` <span class="muted">${training.errors} failed to send.</span>` : '') +
      (training.viaMubit && demo?.id ? `<span class="mubit-where">In Mubit: task <b>Control web browser</b>. Filter Requests by session <button class="copy" data-copy="demo-${esc(demo.id)}">demo-${esc(demo.id)}</button> to see these exact calls.</span>` : '');
  } catch (err) {
    $('saved-summary').textContent = `Could not save the demonstration: ${err.message}`;
  }
  state.saving = false;
  $('rerun').disabled = false;
  refreshMemory();
}

// The autopsy: compare the failed run with the human's demonstration and flag the
// first step where they part ways. Typed text may differ (names etc.), so for "type"
// only the field counts.
function markMistake(agentSteps, demoSteps) {
  const host = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
  const key = st => [st.action, (st.label || '').toLowerCase(),
    st.action === 'open_url' ? host(st.value) : st.action === 'select' ? String(st.value).toLowerCase() : ''].join('|');
  const meaningful = st => !['wait', 'scroll'].includes(st.action);
  const a = agentSteps.filter(meaningful);
  const d = demoSteps.filter(meaningful);
  let i = 0;
  while (i < a.length && i < d.length && key(a[i]) === key(d[i])) i++;
  if (i >= d.length) return null;
  const row = (a[i] || a[a.length - 1])?.li;
  const text = a[i]
    ? `Mistake at step ${i + 1}: I did ${describeAction(a[i])}, you did ${describeAction(d[i])}.`
    : `I stopped too early: next, you did ${describeAction(d[i])}.`;
  if (row) {
    row.classList.add('mistake');
    row.insertAdjacentHTML('beforeend', `<div class="mistake-note">${esc(text)}</div>`);
    row.scrollIntoView({ block: 'nearest' });
  }
  return text;
}

async function rerun() {
  resetRunUi();
  addStep(stepHtml('Reloading the page'), { kind: 'note' });
  const tab = await tabById(state.runTabId);
  await goTo(tab.id, state.lastStartUrl);
  await sleep(300);
  run(state.lastGoal);
}

// Keep recording across page navigations during a demonstration.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!state.recording || tabId !== state.recordTabId) return;
  // A URL change no recorded click or Enter explains (within 4 s) means the human used
  // the address bar or a bookmark: record it as open_url.
  if (info.url && info.url !== state.lastUrl) {
    if (isWebPage(info.url) && Date.now() - state.lastStepAt > 4000) {
      onRecorded({ action: 'open_url', element_id: '', label: '', role: '', value: info.url, led_to: info.url,
        page: { url: state.lastUrl || 'about:blank', title: '', headings: [], elements: [], text: '', note: 'none (browser start page: use open_url to go to a site)' } });
    } else {
      // Caused by the step just recorded: remember where it led, to spot detours later.
      const last = state.recorded[state.recorded.length - 1];
      if (last && !last.led_to) last.led_to = info.url;
    }
    state.lastUrl = info.url;
  }
  if (info.status === 'complete' && isWebPage(tab.url)) {
    send(tabId, { type: 'showme:record', on: true }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'showme:recorded' && sender.tab?.id === state.recordTabId) onRecorded(msg.step);
  if (msg.type === 'showme:recording?' && state.recording && sender.tab?.id === state.recordTabId) reply({ on: true });
});

// New tabs and tab switches while you teach: record them, and follow you there.
const startPage = () => ({ url: state.lastUrl || 'about:blank', title: '', headings: [], elements: [], text: '', note: 'none (browser start page: use open_url to go to a site)' });
async function followTab(tab) {
  if (state.recordTabId && state.recordTabId !== tab.id) send(state.recordTabId, { type: 'showme:record', on: false }).catch(() => {});
  state.recordTabId = tab.id;
  state.lastUrl = tab.url || tab.pendingUrl || 'chrome://newtab/';
  if (isWebPage(tab.url)) send(tab.id, { type: 'showme:record', on: true }).catch(() => {});
}
chrome.tabs.onCreated.addListener(tab => {
  if (!state.recording) return;
  // A link on the page you're teaching opened it (in front or behind): follow it at once.
  // The click that opened it is already recorded, and that click leads here.
  if (tab.openerTabId === state.recordTabId || Date.now() - state.lastStepAt < 1500) {
    state.newTabId = tab.id;
    const last = state.recorded[state.recorded.length - 1];
    if (last && !last.led_to && tab.pendingUrl) last.led_to = tab.pendingUrl;
    state.recordTabId = tab.id;
    state.lastUrl = tab.pendingUrl || tab.url || state.lastUrl;
    return;
  }
  state.newTabId = tab.id;
  onRecorded({ action: 'new_tab', element_id: '', label: '', role: '', value: '', page: startPage() });
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!state.recording || tabId === state.recordTabId) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || (isOwnPage(tab.url) && !tab.url?.startsWith('chrome://newtab'))) return;
  if (tabId !== state.newTabId) onRecorded({ action: 'switch_tab', element_id: '', label: tab.title || '', role: '', value: tab.url, page: startPage() });
  state.newTabId = null;
  await followTab(tab);
});

// ---- Sheet to form ------------------------------------------------------------
// Read rows from a sheet, watch you do row 1 on a form, work out where each value comes
// from, then run the same skill for every other row. The loop is code, not the model: each
// row is a short run of the taught skill with that row's values.

const doneKey = skill => `sheetDone:${skill}`;
async function doneRows(skill) {
  const got = await chrome.storage.local.get(doneKey(skill));
  return new Set(got[doneKey(skill)] || []);
}
async function markRowsDone(skill, rows) {
  const done = await doneRows(skill);
  rows.forEach(r => done.add(rowKey(r)));
  await chrome.storage.local.set({ [doneKey(skill)]: [...done] });
}

function sheetFromLesson(steps) {
  const rules = inferRules(steps, state.sheet.rows[0], state.sheet.columns);
  const lastFill = steps.map(st => st.action === 'type' || st.action === 'select').lastIndexOf(true);
  const submit = steps.slice(lastFill + 1).reverse().find(st => st.action === 'click' && st.role === 'button')?.label || '';
  return { columns: state.sheet.columns, startUrl: state.lastStartUrl, submit, rules };
}

function showSheetPart(part) {
  $('sheet').hidden = false;
  for (const id of ['sheet-source', 'sheet-review', 'sheet-batch']) $(id).hidden = id !== part;
}

async function openSheet(saved = null) {
  if (state.running) return;
  $('sheet-learned').hidden = true;
  state.sheetSkill = saved;
  state.sheet = null;
  resetRunUi();
  showSheetPart('sheet-source');
  $('sheet-skill').value = saved?.name || '';
  $('sheet-skill').disabled = !!saved;
  $('sheet-next').hidden = true;
  $('sheet-info').textContent = saved ? 'Read this week\'s rows, then check the fields and run.' : '';
  const tabs = (await chrome.tabs.query({ currentWindow: true })).filter(t => isWebPage(t.url));
  const likely = tabs.find(t => /docs\.google\.com\/spreadsheets|\.csv\b|\/sheet\b|sheet/i.test(`${t.url} ${t.title}`)) || tabs.find(t => t.active);
  $('sheet-tab').innerHTML = tabs.map(t => `<option value="${t.id}"${t === likely ? ' selected' : ''}>${esc((t.title || t.url).slice(0, 60))}</option>`).join('');
  $('sheet').scrollIntoView({ block: 'nearest' });
}

async function readSheet() {
  const tabId = Number($('sheet-tab').value);
  if (!tabId) return;
  $('sheet-info').textContent = 'Reading…';
  try {
    const got = await send(tabId, { type: 'showme:table' });
    if (!got?.ok) throw new Error(got?.error || 'Could not read that tab.');
    setSheet(got.csv != null ? parseCsv(got.csv) : toTable(got.grid), tabId);
  } catch (err) {
    $('sheet-info').textContent = err.message;
  }
}

function setSheet(table, tabId = null) {
  if (!table.rows.length) { $('sheet-info').textContent = 'No rows found. Each column needs a heading in the first row.'; return; }
  state.sheet = { ...table, tabId };
  $('sheet-info').textContent = `${table.rows.length} rows · columns: ${table.columns.join(', ')}`;
  const saved = state.sheetSkill;
  if (saved) {
    const missing = saved.rules.filter(r => r.type === 'column' && !table.columns.includes(r.column)).map(r => r.column);
    if (missing.length) { $('sheet-info').textContent += `. Missing column${missing.length === 1 ? '' : 's'} this skill uses: ${missing.join(', ')}.`; return; }
    showSheetReview();
  } else {
    $('sheet-next').hidden = false;
  }
}

async function teachRow1() {
  const skill = $('sheet-skill').value.trim() || 'Fill in a form from a sheet';
  const tab = await targetTab().catch(() => null);
  if (!tab || !isWebPage(tab.url)) { $('sheet-info').textContent = 'Open your form in a tab first.'; return; }
  if (tab.id === state.sheet.tabId) { $('sheet-info').textContent = 'Switch to the tab with your form, then press Start.'; return; }
  Object.assign(state, { runTabId: tab.id, lastStartUrl: tab.url, lastGoal: skill, runSteps: [], teachSkill: skill, usedSkill: null, sheetTeach: true });
  $('sheet').hidden = true;
  resetRunUi();
  $('teach').hidden = false;
  addStep(stepHtml(esc(`Teaching “${skill}”: do row 1 on this form`), { why: esc(Object.values(state.sheet.rows[0]).filter(Boolean).join(' · ')) }), { kind: 'note' });
  await startTeaching();
}

// The review card: every field and where its value comes from. Change any that are wrong.
async function showSheetReview() {
  const sk = state.sheetSkill;
  $('teach').hidden = true;
  showSheetPart('sheet-review');
  const list = $('sheet-rules');
  list.innerHTML = '';
  sk.rules.forEach(rule => {
    const choices = [
      ...state.sheet.columns.map(c => ({ key: `column:${c}`, text: `from column “${c}”`, set: { type: 'column', column: c } })),
      { key: 'fixed', text: `always “${rule.value}”`, set: { type: 'fixed' } },
      ...(rule.note && generatedFromNote(rule.note, rule.value) ? [{ key: 'generated', text: describeRule({ ...rule, type: 'generated', ...generatedFromNote(rule.note, rule.value) }), set: { type: 'generated', ...generatedFromNote(rule.note, rule.value) } }] : []),
      ...(rule.note ? [{ key: 'note', text: `follow your note: “${rule.note}”`, set: { type: 'note' } }] : []),
      { key: 'ask', text: 'ask me for each row', set: { type: 'ask' } },
    ];
    const current = rule.type === 'column' ? `column:${rule.column}` : rule.type;
    const li = document.createElement('li');
    li.innerHTML = `<span class="field">${esc(rule.label)}</span><select aria-label="Where ${esc(rule.label)} comes from">${choices.map(c => `<option value="${esc(c.key)}"${c.key === current ? ' selected' : ''}>${esc(c.text)}</option>`).join('')}</select>` +
      (rule.type === 'column' && rule.note ? `<span class="why">If the cell is blank: “${esc(rule.note)}”</span>` : '');
    li.querySelector('select').addEventListener('change', e => Object.assign(rule, choices.find(c => c.key === e.target.value).set));
    list.appendChild(li);
  });
  const done = await doneRows(sk.name);
  const todo = state.sheet.rows.filter(r => !done.has(rowKey(r)));
  $('sheet-rows').textContent = `${todo.length} of ${state.sheet.rows.length} rows to do` + (todo.length < state.sheet.rows.length ? ` (${state.sheet.rows.length - todo.length} already done).` : '.');
  $('sheet-approve-text').textContent = sk.submit ? `Press “${sk.submit}” for every row without asking` : 'Approve risky clicks for every row';
  $('sheet-run').textContent = `Run ${todo.length} row${todo.length === 1 ? '' : 's'}`;
  $('sheet-run').disabled = !todo.length;
}

function askValue(label, n) {
  return new Promise(resolve => {
    $('batch-ask').hidden = false;
    $('batch-ask-label').textContent = `Row ${n}: what should “${label}” be?`;
    $('batch-ask-input').value = '';
    $('batch-ask-input').focus();
    $('batch-ask-go').onclick = () => { $('batch-ask').hidden = true; resolve($('batch-ask-input').value.trim()); };
  });
}

async function batchTab(startUrl) {
  const usable = async id => { const t = id && await chrome.tabs.get(id).catch(() => null); return t && t.id !== state.sheet.tabId && isWebPage(t.url) ? t : null; };
  const tab = await usable(state.runTabId) || await usable((await targetTab().catch(() => null))?.id);
  return tab || chrome.tabs.create({ url: startUrl, active: true });
}

async function runBatch(onlyRows = null) {
  if (state.running) return;
  const sk = state.sheetSkill;
  const all = state.sheet.rows;
  const done = await doneRows(sk.name);
  const todo = (onlyRows || all).filter(r => !done.has(rowKey(r)));
  if (!todo.length) return;
  state.running = true;
  state.stopRequested = false;
  state.abort = new AbortController();
  state.batch = { paused: false, failed: [] };
  $('run').disabled = true;
  showSheetPart('sheet-batch');
  $('batch-retry').hidden = true;
  $('batch-close').hidden = true;
  $('batch-pause').hidden = false; $('batch-stop').hidden = false;
  $('batch-pause').textContent = 'Pause';
  const list = $('batch-rows');
  list.innerHTML = '';
  const approved = $('sheet-approve').checked && sk.submit ? new Set([sk.submit]) : null;
  const tab = await batchTab(sk.startUrl);
  state.runTabId = tab.id;
  state.run = { calls: 0, providerUsd: 0, adapterUsd: 0, ms: 0, adapterMs: null };
  let ok = 0;
  for (let i = 0; i < todo.length; i++) {
    while (state.batch.paused && !state.stopRequested) await sleep(250);
    if (state.stopRequested) break;
    const row = todo[i];
    const n = all.indexOf(row) + 1;
    $('batch-title').textContent = `Row ${n} of ${all.length}…`;
    $('batch-bar').style.width = `${Math.round((i / todo.length) * 100)}%`;
    const li = document.createElement('li');
    const who = Object.values(row).find(Boolean) || `Row ${n}`;
    li.innerHTML = `<span class="mark">…</span><span>Row ${n}: ${esc(who)}<span class="why">working</span></span>`;
    list.appendChild(li);
    li.scrollIntoView({ block: 'nearest' });
    const answers = {};
    for (const r of sk.rules.filter(x => x.type === 'ask')) answers[r.label] = await askValue(r.label, n);
    const values = valuesForRow(sk.rules, row, { answers });
    const goal = rowGoal(sk.name, n, all.length, values);
    await goTo(tab.id, sk.startUrl);
    const r = await runAgent({ goal, tabId: tab.id, api, signal: state.abort.signal, isStopped: () => state.stopRequested, skill: sk.name, approved, row: n, ui: { usage: addUsage } });
    const good = r.outcome === 'done';
    li.className = good ? 'ok' : 'bad';
    li.querySelector('.mark').textContent = good ? '✓' : r.outcome === 'stopped' ? '■' : '✗';
    li.querySelector('.why').textContent = good ? values.filter(v => v.value).map(v => v.value).slice(1, 4).join(' · ') : (r.failure || 'Not done');
    if (good) { ok++; await markRowsDone(sk.name, [row]); } else if (r.outcome !== 'stopped') state.batch.failed.push(row);
  }
  $('batch-bar').style.width = '100%';
  const failed = state.batch.failed.length;
  $('batch-title').textContent = state.stopRequested ? `Stopped: ${ok} row${ok === 1 ? '' : 's'} done` : `Done: ${ok} of ${todo.length} rows${failed ? `, ${failed} need a look` : ' ✓'}`;
  $('batch-pause').hidden = true; $('batch-stop').hidden = true;
  $('batch-retry').hidden = !failed;
  $('batch-close').hidden = false;
  state.running = false;
  state.abort = null;
  $('run').disabled = false;
  note(failed ? 'fail' : 'done');
  mo(failed ? 'stuck' : 'success', { text: failed ? `${ok} rows done. ${failed} need a look.` : `All ${ok} rows done!` });
  refreshMemory();
  refreshTotals();
}

// ---- Voice --------------------------------------------------------------------
// Push to talk. Hold ⌥Space (on a page or here) or hold the mic button, let go to run,
// Esc to cancel. While the panel is open it does the listening: the background routes
// key holds from Mo here through our port. Dictation apps such as Wispr Flow also work:
// they type straight into the goal box.

const BARS = 20;
const TAP_MS = 250;
let voice = null;
let voiceTab = null;

function drawWave(levels) {
  const wave = $('wave');
  if (!wave.children.length) wave.innerHTML = '<span></span>'.repeat(BARS);
  [...wave.children].forEach((bar, i) => { bar.style.height = `${4 + Math.round((levels[i] || 0) * 22)}px`; });
}

function voiceUi(on) {
  $('mic').classList.toggle('listening', on);
  $('composer').classList.toggle('listening', on);
  $('wave').hidden = !on;
}

function tellTab(payload) {
  if (voiceTab) chrome.tabs.sendMessage(voiceTab, { type: 'showme:voice', ...payload }).catch(() => {});
}

async function startVoice(tabId) {
  if (voice && !voice.ended) return;
  voiceTab = tabId || (await targetTab().catch(() => null))?.id || null;
  const status = $('mic-status');
  status.hidden = false;
  status.textContent = 'Listening… let go to run, Esc to cancel.';
  const previous = $('goal').value;
  const session = createVoiceSession({
    onLevels: ({ id, levels, text }) => {
      if (session !== voice) return;
      drawWave(levels);
      if (text) $('goal').value = text;
      tellTab({ state: 'listening', id, levels, text });
    },
    onError: ({ error }) => {
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        status.textContent = 'Allow the microphone in the tab that just opened, then try again.';
        chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') });
      } else {
        status.textContent = error === 'unsupported' ? 'Speech recognition is not available in this browser. Type the goal instead.' : `Voice error: ${error}. Type the goal instead.`;
      }
    },
    onEnd: ({ id, text, cancelled }) => {
      voiceUi(false);
      tellTab({ state: text && !cancelled ? 'heard' : (cancelled ? 'cancelled' : 'off'), id, text });
      if (cancelled || !text) {
        $('goal').value = previous;
        if (!status.textContent.startsWith('Allow') && !status.textContent.startsWith('Voice error') && !status.textContent.startsWith('Speech')) status.textContent = cancelled ? 'Cancelled.' : 'I didn\'t catch anything. Hold and talk, then let go.';
        return;
      }
      $('goal').value = text;
      chrome.storage.local.set({ goal: text });
      note('voice');
      status.textContent = 'Got it.';
      if ($('autorun').checked) run(text);
    },
  });
  voice = session;
  voiceUi(true);
  session.start();
}

const stopVoice = () => voice?.stop();
const cancelVoice = () => voice?.cancel();

// Mic button: press and hold to talk; a quick tap just explains how.
let micHeldAt = 0;
function micDown(e) {
  e.preventDefault();
  $('mic').setPointerCapture?.(e.pointerId);
  micHeldAt = Date.now();
  startVoice();
}
function micUp() {
  if (!micHeldAt) return;
  const quick = Date.now() - micHeldAt < TAP_MS;
  micHeldAt = 0;
  if (quick) { cancelVoice(); $('mic-status').hidden = false; $('mic-status').textContent = 'Hold the mic (or ⌥Space) while you talk, then let go.'; }
  else stopVoice();
}

// ⌥Space while the panel itself has focus.
let keysHeldAt = 0;
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (!e.repeat && !keysHeldAt) { keysHeldAt = Date.now(); startVoice(); }
  } else if (e.key === 'Escape' && (keysHeldAt || micHeldAt)) {
    keysHeldAt = 0; micHeldAt = 0; cancelVoice();
  }
});
document.addEventListener('keyup', e => {
  if (keysHeldAt && (e.code === 'Space' || e.key === 'Alt')) {
    const quick = Date.now() - keysHeldAt < TAP_MS;
    keysHeldAt = 0;
    quick ? cancelVoice() : stopVoice();
  }
});

// Holds on a page reach us through the background while the panel is open.
const port = chrome.runtime.connect({ name: 'panel' });
port.onMessage.addListener(msg => {
  if (msg.type === 'voice-start') startVoice(msg.tabId);
  if (msg.type === 'voice-stop') stopVoice();
  if (msg.type === 'voice-cancel') cancelVoice();
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'showme:teach-request') resumePendingTeach().then(found => {
    if (!found && !$('teach-ask').hidden && !$('teach').hidden) startTeaching().catch(err => offerTeaching(err.message));
  });
});

// A voice run that failed while the panel was closed leaves what's needed to teach it.
async function resumePendingTeach() {
  const { pendingTeach } = await chrome.storage.session.get('pendingTeach').catch(() => ({}));
  if (!pendingTeach || Date.now() - pendingTeach.at > 15 * 60 * 1000) return false;
  await chrome.storage.session.remove('pendingTeach');
  switchView('agent');
  resetRunUi();
  Object.assign(state, { lastGoal: pendingTeach.goal, runTabId: pendingTeach.tabId, lastStartUrl: pendingTeach.startUrl, runSteps: [] });
  $('goal').value = pendingTeach.goal;
  addStep(stepHtml(esc(`Voice run: “${pendingTeach.goal}”`), { why: esc(pendingTeach.failure) }), { error: true, kind: 'note' });
  setVerdict(false, 'Failed');
  offerTeaching(pendingTeach.failure);
  return true;
}

// ---- Mo -------------------------------------------------------------------------

async function mo(stateName, extra = {}, tabId = null) {
  moOn(tabId || state.runTabId || (await targetTab().catch(() => null))?.id, stateName, extra);
}

// ---- Mubit and Judges tabs ----------------------------------------------------------

const session = { startedAt: Date.now(), events: [] }; // what happened in this panel, for the Judges tab
const note = type => { session.events.push({ type, at: Date.now() }); judges.render(); };

const mubit = createMubitView({ api, getServer: () => state.server, onOverview: data => judges.update(data) });
const judges = createJudgesView({ session });

// ---- Wiring -------------------------------------------------------------------

// The tab the agent will work on, as a small chip: its icon and site.
async function updateTargetLabel() {
  const tab = await targetTab().catch(() => null);
  const chip = $('target-chip');
  if (!tab) { chip.hidden = true; return; }
  let site = tab.title || 'this tab';
  try { if (/^https?:/.test(tab.url)) site = new URL(tab.url).hostname.replace(/^www\./, ''); else if (!isWebPage(tab.url)) site = 'New tab'; } catch { /* keep the title */ }
  $('target').textContent = site;
  chip.title = `Works on: ${tab.title || tab.url}`;
  const icon = $('target-icon');
  if (tab.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl)) icon.src = tab.favIconUrl; else icon.removeAttribute('src');
  chip.hidden = false;
}

function switchView(view) {
  document.querySelectorAll('.tab').forEach(t => {
    const active = t.dataset.view === view;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  for (const name of ['agent', 'mubit', 'judges']) $(`view-${name}`).hidden = view !== name;
  if (view !== 'agent') mubit.refresh();
  if (view === 'mubit') note('ledger');
}

async function init() {
  const saved = await chrome.storage.local.get(['server', 'goal', 'speak', 'present', 'autorun']);
  if (saved.autorun === false) $('autorun').checked = false;
  if (saved.present) { document.body.classList.add('present'); $('present').checked = true; }
  if (saved.server) state.server = saved.server;
  if (saved.goal) $('goal').value = saved.goal;
  if (saved.speak === false) $('speak').checked = false;
  $('speak').addEventListener('change', () => chrome.storage.local.set({ speak: $('speak').checked }));
  $('server').value = state.server;

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
  $('run').addEventListener('click', () => run($('goal').value));
  $('goal').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run($('goal').value); } });
  $('goal').addEventListener('input', () => chrome.storage.local.set({ goal: $('goal').value }));
  $('stop').addEventListener('click', () => { state.stopRequested = true; state.abort?.abort(); });
  $('mic').addEventListener('pointerdown', micDown);
  $('mic').addEventListener('pointerup', micUp);
  $('mic').addEventListener('pointercancel', () => { micHeldAt = 0; cancelVoice(); });
  $('autorun').addEventListener('change', () => chrome.storage.local.set({ autorun: $('autorun').checked }));
  // Copy a Mubit session or request id, to paste into the console's Requests filter.
  document.addEventListener('click', e => {
    const b = e.target.closest('button.copy');
    if (!b) return;
    navigator.clipboard?.writeText(b.dataset.copy);
    const was = b.textContent;
    b.textContent = 'Copied ✓';
    setTimeout(() => { b.textContent = was; }, 1200);
  });
  $('not-right').addEventListener('click', () => offerTeaching('Do it your way once, and I\'ll do it like that from now on.', 'Not what you wanted?'));
  $('show-me').addEventListener('click', () => startTeaching().catch(err => offerTeaching(err.message)));
  $('done-teaching').addEventListener('click', finishTeaching);
  $('cancel-teaching').addEventListener('click', async () => { await stopRecording(); state.sheetTeach = false; state.teachSkill = null; offerTeaching('Demonstration cancelled.'); });
  $('back-to-recording').addEventListener('click', async () => {
    $('teach-review').hidden = true;
    $('teach-recording').hidden = false;
    state.recording = true;
    renderRecorded();
    if (state.recordTabId) await send(state.recordTabId, { type: 'showme:record', on: true }).catch(() => {});
  });
  $('rerun').addEventListener('click', rerun);
  $('from-sheet').addEventListener('click', () => openSheet());
  $('sheet-read').addEventListener('click', readSheet);
  $('sheet-paste').addEventListener('click', () => setSheet(parseCsv($('sheet-csv').value)));
  $('sheet-teach').addEventListener('click', () => teachRow1().catch(err => { $('sheet-info').textContent = err.message; }));
  $('sheet-run').addEventListener('click', () => runBatch());
  for (const id of ['sheet-cancel', 'sheet-close', 'batch-close']) $(id).addEventListener('click', () => { $('sheet').hidden = true; });
  $('batch-pause').addEventListener('click', () => { state.batch.paused = !state.batch.paused; $('batch-pause').textContent = state.batch.paused ? 'Resume' : 'Pause'; });
  $('batch-stop').addEventListener('click', () => { state.stopRequested = true; state.abort?.abort(); if (state.batch) state.batch.paused = false; });
  $('batch-retry').addEventListener('click', () => runBatch(state.batch.failed));
  $('forget').addEventListener('click', async () => { await api('/api/demonstrations', { method: 'DELETE' }).catch(() => {}); refreshMemory(); });
  $('refresh-ledger').addEventListener('click', () => mubit.refresh());
  $('reset-ledger').addEventListener('click', async () => { await api('/api/ledger', { method: 'DELETE' }).catch(() => {}); mubit.refresh(); });
  $('save-real').addEventListener('click', () => mubit.saveRealNumbers().catch(err => alertInline(err.message)));
  $('clear-real').addEventListener('click', () => mubit.saveRealNumbers(true).catch(err => alertInline(err.message)));
  $('present').addEventListener('change', () => { document.body.classList.toggle('present', $('present').checked); chrome.storage.local.set({ present: $('present').checked }); });
  // Settings menu
  const closeMenu = () => { $('more-menu').hidden = true; $('more').setAttribute('aria-expanded', 'false'); };
  $('more').addEventListener('click', e => { e.stopPropagation(); const open = $('more-menu').hidden; $('more-menu').hidden = !open; $('more').setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  // Example goals fill the composer
  document.querySelectorAll('.example').forEach(b => b.addEventListener('click', () => {
    $('goal').value = b.dataset.goal.replace('http://localhost:8787', state.server);
    chrome.storage.local.set({ goal: $('goal').value });
    $('goal').focus();
  }));
  $('server').addEventListener('change', async () => {
    state.server = $('server').value.replace(/\/$/, '');
    await chrome.storage.local.set({ server: state.server }); // the background reads it for voice runs
    refreshHealth(); refreshMemory(); mubit.connect(); mubit.refresh();
  });
  chrome.tabs.onActivated.addListener(updateTargetLabel);
  chrome.tabs.onUpdated.addListener((_id, info) => { if (info.title || info.status === 'complete') updateTargetLabel(); });

  updateTargetLabel();
  refreshHealth();
  refreshMemory();
  refreshTotals();
  mubit.connect();
  mubit.refresh();
  resumePendingTeach();
  // Kept examples and adapter status, read from Mubit's console when it's open in a tab.
  const { mubitBridge } = await chrome.storage.local.get('mubitBridge');
  if (mubitBridge) { mubit.setBridge(mubitBridge); judges.setBridge(mubitBridge); }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.mubitBridge?.newValue) {
      mubit.setBridge(changes.mubitBridge.newValue);
      judges.setBridge(changes.mubitBridge.newValue);
    }
  });
  setInterval(refreshHealth, 15000);
}

function alertInline(message) {
  $('bridge-status').textContent = message;
}

init();
