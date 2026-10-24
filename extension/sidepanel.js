// Show Me side panel: runs the agent loop against the current tab, asks for a
// demonstration when the run fails, and shows the Mubit ledger.

import { createMubitView, esc, fmtUsd } from './panel-mubit.js';
import { createJudgesView } from './panel-judges.js';

const $ = id => document.getElementById(id);
const MAX_STEPS = 20;
const RISKY = /pay|purchase|buy now|place order|delete|remove|transfer|send/i;
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
};

// ---- Backend ----------------------------------------------------------------

// Errors from the backend, Mubit or the provider. They are not the agent's mistakes,
// so they never trigger "show me".
class InfraError extends Error {}

async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${state.server}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new InfraError(`Backend offline at ${state.server}. Start it with: npm start`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.agentError) throw new Error(`I gave an answer I couldn't act on (${data.error.slice(0, 120)}…)`);
  if (!res.ok) throw new InfraError(data.error || `${res.status} ${res.statusText}`);
  return data;
}

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
    pill.textContent = h.viaMubit ? `${h.model} via Mubit` : 'Mock model (no Mubit key)';
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
    const { demos } = await api('/api/demonstrations');
    $('memory-count').textContent = `Memory: ${demos.length} lesson${demos.length === 1 ? '' : 's'}`;
  } catch {
    $('memory-count').textContent = 'Memory: backend offline';
  }
}

// ---- Tab + content script ---------------------------------------------------

const isOwnPage = url => !url || url.startsWith(chrome.runtime.getURL(''));
const isWebPage = url => /^(https?|file):/.test(url || '');

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForLoad(tabId, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
    await sleep(150);
  }
  throw new InfraError('The page took too long to load');
}

async function send(tabId, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const reply = await chrome.tabs.sendMessage(tabId, message);
      if (reply) return reply;
    } catch {
      // No content script yet (page opened before the extension loaded, or mid-navigation).
      await waitForLoad(tabId).catch(() => {});
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
      await sleep(150);
    }
  }
  throw new InfraError('Show Me cannot read this page (try reloading it; chrome:// pages are off limits)');
}

async function snapshot(tabId) {
  const tab = await waitForLoad(tabId);
  // A new tab or chrome:// page can't be read, but the agent can still open a site from it.
  if (!isWebPage(tab.url)) {
    return { url: tab.url || 'about:blank', title: tab.title || 'New tab', headings: [], elements: [], text: '',
      note: 'none (browser start page: use open_url to go to a site)' };
  }
  const reply = await send(tabId, { type: 'showme:snapshot' });
  if (!reply.ok) throw new Error(reply.error);
  return reply.page;
}

// ---- Timeline ---------------------------------------------------------------

function describeAction(a) {
  const target = a.label ? `“${a.label}”` : (a.element_id || 'the page');
  switch (a.action) {
    case 'type': return `type “${a.value}” into ${target}${a.submit ? ' + Enter' : ''}`;
    case 'select': return `select “${a.value}” in ${target}`;
    case 'press': return `press ${a.value}${a.label ? ` on ${target}` : ''}`;
    case 'open_url': return `open ${shortUrl(a.value)}`;
    case 'back': return 'go back';
    case 'scroll': return `scroll ${a.value || 'down'}`;
    case 'wait': return 'wait for the page';
    case 'ask_human': return `ask you: “${a.value}”`;
    case 'done': return 'finish';
    default: return `click ${target}`;
  }
}

function shortUrl(url) {
  try { const u = new URL(url); return (u.host + u.pathname + u.search).replace(/\/$/, '').slice(0, 60); } catch { return String(url).slice(0, 60); }
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

function renderSavings() {
  const box = $('savings');
  const r = state.run;
  if (!r?.calls && !totals?.callsViaMubit) { box.hidden = true; return; }
  box.hidden = false;
  const runLine = r?.calls
    ? `<div><b>This run</b> · ${r.calls} calls via Mubit · ${fmtUsd(r.providerUsd)} on the model vs ~${fmtUsd(r.adapterUsd)} on an adapter · ${Math.round(r.ms / r.calls)} ms vs ~${r.adapterMs} ms per decision</div>`
    : '';
  const totalLine = totals?.callsViaMubit
    ? `<div class="muted">All time · ${totals.callsViaMubit} calls · spent ${fmtUsd(totals.providerUsd)} · adapter would save ~${fmtUsd(totals.savedUsdEstimate)} (${Math.round(100 * totals.savedUsdEstimate / (totals.providerUsd || 1))}%)</div>`
    : '';
  box.innerHTML = runLine + totalLine;
}

function speak(text) {
  if (!$('speak').checked || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function addStep(html, { error = false } = {}) {
  const li = document.createElement('li');
  li.innerHTML = html;
  if (error) li.classList.add('error');
  $('timeline').appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
  return li;
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
  $('teach').hidden = true;
}

// ---- Agent loop -------------------------------------------------------------

async function run(goal) {
  if (state.running || !goal.trim()) return;
  state.running = true;
  state.stopRequested = false;
  state.abort = new AbortController();
  const signal = state.abort.signal;
  $('run').disabled = true;
  $('stop').hidden = false;
  if (state.recording) await stopRecording();
  resetRunUi();

  const sessionId = `run-${Date.now()}`;
  const history = [];
  let failure = null;
  let infra = false;
  let finished = false;
  let asked = false;
  let usedLesson = false;
  let decisions = 0;
  let invalid = 0;

  try {
    const tab = await targetTab();
    if (!tab) throw new InfraError('No tab to work on');
    state.runTabId = tab.id;
    state.lastGoal = goal;
    state.lastStartUrl = tab.url;
    state.runSteps = [];
    state.run = { calls: 0, providerUsd: 0, adapterUsd: 0, ms: 0, adapterMs: null };
    renderSavings();
    for (let step = 1; step <= MAX_STEPS && !state.stopRequested; step++) {
      const page = await snapshot(tab.id);
      const next = await api('/api/next-action', { method: 'POST', body: { goal, page, history, sessionId }, signal });
      addUsage(next.usage, next.ms);
      decisions++;
      if (!next.valid) invalid++;
      if (next.demoUsed) usedLesson = true;
      const lesson = next.demoUsed ? '<span class="badge lesson">from lesson</span>' : '';
      const cost = next.usage?.viaMubit ? ` · ${fmtUsd(next.usage.costUsd)}` : '';
      const li = addStep(`<b>${step}.</b> ${esc(describeAction(next))}${lesson}<div class="meta">${esc(next.reason)} · ${next.ms} ms${cost}</div>`, { error: !next.valid });

      if (next.action === 'done') { finished = true; break; }
      if (!next.valid) { failure = next.action === 'open_url' ? 'I tried to open an address that is not a web URL.' : 'I picked an element that is not on the page.'; break; }
      if (next.action === 'ask_human') { failure = `I need help: ${next.value || next.reason}`; asked = true; break; }

      const same = h => h.action === next.action && h.label === next.label && h.value === next.value;
      const limit = next.action === 'scroll' || next.action === 'wait' ? 4 : 2;
      if (history.filter(same).length >= limit) { failure = `I kept repeating “${describeAction(next)}”.`; break; }

      if ((next.role === 'button' || next.role === 'link') && RISKY.test(next.label || '')) {
        const gate = await api('/api/safety-gate', { method: 'POST', body: { goal, action: next, element: { label: next.label, role: next.role }, sessionId }, signal });
        addUsage(gate.usage, gate.ms);
        if (!gate.allow) { failure = `Safety gate blocked “${next.label}”: ${gate.reason}`; break; }
      }

      const before = (await chrome.tabs.get(tab.id)).url;
      const result = await perform(tab.id, next);
      if (!result.ok) { failure = result.error; li.classList.add('error'); break; }
      const entry = { action: next.action, label: next.label, role: next.role, value: next.value, submit: next.submit, element_id: next.element_id };
      history.push(entry);
      state.runSteps.push({ ...entry, li });
      await sleep(next.action === 'wait' ? 1500 : 600);
      const after = await waitForLoad(tab.id).catch(() => null);
      if (after && after.url !== before) li.querySelector('.meta').insertAdjacentHTML('beforeend', ` · now on ${esc(shortUrl(after.url))}`);
    }

    if (state.stopRequested) failure = 'Stopped.';
    else if (!failure && !finished) failure = `I ran out of steps (${MAX_STEPS}).`;

    if (!failure) {
      await sleep(400);
      const check = await api('/api/done-check', { method: 'POST', body: { goal, page: await snapshot(tab.id), sessionId }, signal });
      addUsage(check.usage, check.ms);
      addStep(`<b>Check:</b> ${check.done ? 'goal met' : 'goal not met'}<div class="meta">${esc(check.reason)} · ${check.ms} ms</div>`, { error: !check.done });
      if (!check.done) failure = check.reason || 'The page does not show the goal as done.';
    }
  } catch (err) {
    if (err.name === 'AbortError' || state.stopRequested) {
      failure = 'Stopped.';
    } else {
      failure = err.message;
      infra = err instanceof InfraError;
      addStep(esc(err.message), { error: true });
    }
  } finally {
    state.running = false;
    state.abort = null;
    $('run').disabled = false;
    $('stop').hidden = true;
  }

  refreshTotals();
  const outcome = !failure ? 'done' : failure === 'Stopped.' ? 'stopped' : infra ? 'error' : asked ? 'asked' : 'failed';
  const finalTab = state.runTabId ? await chrome.tabs.get(state.runTabId).catch(() => null) : null;
  reportRun({ goal, outcome, usedLesson, steps: history.length, decisions, invalid,
    tools: [...new Set(history.map(h => h.action).concat(finished ? ['done'] : []))], url: finalTab?.url || null });
  note(outcome === 'done' ? (usedLesson ? 'rerun-done' : 'done') : outcome === 'failed' || outcome === 'asked' ? 'fail' : outcome);
  if (failure) {
    setVerdict(false, failure === 'Stopped.' ? 'Stopped' : infra ? 'Error — not the agent\'s fault, so nothing to teach' : asked ? 'Asked for help' : 'Failed');
    if (failure !== 'Stopped.' && !infra) {
      offerTeaching(failure);
      speak(asked ? `I need help. ${failure.replace(/^I need help: /, '')}. Can you show me?` : 'I couldn\'t finish this. Can you show me how?');
    }
  } else {
    setVerdict(true, 'Done ✓');
    speak('Done.');
  }
}

// Actions the browser does itself; the rest happen inside the page.
async function perform(tabId, action) {
  if (action.action === 'open_url') {
    await chrome.tabs.update(tabId, { url: action.value });
    await sleep(400);
    await waitForLoad(tabId, 30000);
    return { ok: true };
  }
  if (action.action === 'back') {
    await chrome.tabs.goBack(tabId).catch(() => {});
    await sleep(400);
    await waitForLoad(tabId);
    return { ok: true };
  }
  if (action.action === 'wait') return { ok: true };
  return send(tabId, { type: 'showme:act', action });
}

// ---- Teaching ("show me") -----------------------------------------------------

function offerTeaching(reason) {
  $('teach').hidden = false;
  $('teach-ask').hidden = false;
  $('teach-recording').hidden = true;
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
  state.lastUrl = page.url;
  state.lastStepAt = Date.now();
  $('recorded').innerHTML = '';
  $('done-teaching').disabled = true;
  $('teach-ask').hidden = true;
  $('teach-recording').hidden = false;
  if (isWebPage(page.url)) await send(tab.id, { type: 'showme:record', on: true });
}

function onRecorded(step) {
  if (!state.recording) return;
  state.lastStepAt = Date.now();
  state.recorded.push(step);
  const li = document.createElement('li');
  li.textContent = describeAction(step);
  $('recorded').appendChild(li);
  $('done-teaching').disabled = false;
}

async function stopRecording() {
  state.recording = false;
  if (state.recordTabId) await send(state.recordTabId, { type: 'showme:record', on: false }).catch(() => {});
}

async function finishTeaching() {
  if (state.saving || !state.recording || !state.recorded.length) return;
  state.saving = true;
  $('done-teaching').disabled = true;
  await stopRecording();
  const steps = state.recorded;
  $('teach-recording').hidden = true;
  $('teach-saved').hidden = false;
  $('saved-summary').textContent = `Saving ${steps.length} steps and sending them through Mubit…`;
  $('rerun').disabled = true;
  try {
    const mistake = markMistake(state.runSteps, steps);
    const { training } = await api('/api/demonstrations', {
      method: 'POST', body: { goal: state.lastGoal, url: steps[0].page.url, steps, mistake },
    });
    note('taught');
    const where = training.viaMubit ? 'through Mubit' : 'to the mock model (no Mubit key, so nothing was recorded)';
    $('saved-summary').innerHTML =
      (mistake ? `<span class="mistake-note">✗ ${esc(mistake)}</span><br>` : '') +
      `<b>Learned.</b> Saved ${steps.length} steps to memory and sent ${training.sent} training examples ${where}` +
      ` (the model matched your demonstration on ${training.agreed}/${steps.length}).` +
      (training.errors ? ` <span class="muted">${training.errors} failed to send.</span>` : '');
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
    row.insertAdjacentHTML('beforeend', `<div class="mistake-note">✗ ${esc(text)}</div>`);
    row.scrollIntoView({ block: 'nearest' });
  }
  return text;
}

async function rerun() {
  resetRunUi();
  addStep('Reloading the page…');
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
      onRecorded({ action: 'open_url', element_id: '', label: '', role: '', value: info.url,
        page: { url: state.lastUrl || 'about:blank', title: '', headings: [], elements: [], text: '', note: 'none (browser start page: use open_url to go to a site)' } });
    }
    state.lastUrl = info.url;
  }
  if (info.status === 'complete' && isWebPage(tab.url)) {
    send(tabId, { type: 'showme:record', on: true }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'showme:recorded' && sender.tab?.id === state.recordTabId) onRecorded(msg.step);
});

// ---- Voice --------------------------------------------------------------------
// Uses Chrome's built-in speech recognition. Dictation apps such as Wispr Flow also
// work with no setup: they type straight into the goal box.

let recognition = null;

function toggleMic() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const status = $('mic-status');
  if (!Speech) { status.hidden = false; status.textContent = 'Speech recognition is not available in this browser. Type the goal instead.'; return; }
  if (recognition) { recognition.stop(); return; }
  recognition = new Speech();
  recognition.lang = navigator.language || 'en-GB';
  recognition.interimResults = true;
  recognition.continuous = false;
  let heard = '';
  let failed = false;
  $('mic').classList.add('listening');
  status.hidden = false;
  status.textContent = 'Listening…';
  recognition.onresult = event => {
    const text = [...event.results].map(r => r[0].transcript).join(' ');
    $('goal').value = text;
    if (event.results[event.results.length - 1].isFinal) {
      heard = text.trim();
      note('voice');
      status.textContent = 'Got it. Press Run, or speak again.';
    }
  };
  recognition.onerror = event => {
    failed = true;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      status.textContent = 'Allow the microphone in the tab that just opened, then try again.';
      chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') });
    } else {
      status.textContent = `Voice error: ${event.error}. Type the goal instead.`;
    }
  };
  recognition.onend = () => {
    $('mic').classList.remove('listening');
    recognition = null;
    chrome.storage.local.set({ goal: $('goal').value });
    // Only auto-run what was actually heard this time, never a leftover goal after an error.
    if (heard && !failed && $('autorun').checked) run(heard);
  };
  recognition.start();
}

// ---- Mubit and Judges tabs ----------------------------------------------------------

const session = { startedAt: Date.now(), events: [] }; // what happened in this panel, for the Judges tab
const note = type => { session.events.push({ type, at: Date.now() }); judges.render(); };

const mubit = createMubitView({ api, getServer: () => state.server, onOverview: data => judges.update(data) });
const judges = createJudgesView({ session });

async function reportRun(run) {
  await api('/api/runs', { method: 'POST', body: run }).catch(() => {});
}

// ---- Wiring -------------------------------------------------------------------

async function updateTargetLabel() {
  const tab = await targetTab().catch(() => null);
  $('target').textContent = tab ? `on: ${tab.title?.slice(0, 40) || tab.url}` : '';
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
  const saved = await chrome.storage.local.get(['server', 'goal', 'speak', 'present']);
  if (saved.present) document.body.classList.add('present');
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
  $('mic').addEventListener('click', toggleMic);
  $('show-me').addEventListener('click', () => startTeaching().catch(err => offerTeaching(err.message)));
  $('done-teaching').addEventListener('click', finishTeaching);
  $('cancel-teaching').addEventListener('click', async () => { await stopRecording(); offerTeaching('Demonstration cancelled.'); });
  $('rerun').addEventListener('click', rerun);
  $('forget').addEventListener('click', async () => { await api('/api/demonstrations', { method: 'DELETE' }).catch(() => {}); refreshMemory(); });
  $('refresh-ledger').addEventListener('click', () => mubit.refresh());
  $('reset-ledger').addEventListener('click', async () => { await api('/api/ledger', { method: 'DELETE' }).catch(() => {}); mubit.refresh(); });
  $('save-real').addEventListener('click', () => mubit.saveRealNumbers().catch(err => alertInline(err.message)));
  $('clear-real').addEventListener('click', () => mubit.saveRealNumbers(true).catch(err => alertInline(err.message)));
  $('present').addEventListener('click', () => { document.body.classList.toggle('present'); chrome.storage.local.set({ present: document.body.classList.contains('present') }); });
  $('server').addEventListener('change', async () => {
    state.server = $('server').value.replace(/\/$/, '');
    await chrome.storage.local.set({ server: state.server });
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
  setInterval(refreshHealth, 15000);
}

function alertInline(message) {
  $('bridge-status').textContent = message;
}

init();
