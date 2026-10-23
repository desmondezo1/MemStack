// Show Me side panel: runs the agent loop against the current tab, asks for a
// demonstration when the run fails, and shows the Mubit ledger.

const $ = id => document.getElementById(id);
const MAX_STEPS = 12;
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

async function targetTab() {
  if (forcedTabId) return chrome.tabs.get(forcedTabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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
  await waitForLoad(tabId);
  const reply = await send(tabId, { type: 'showme:snapshot' });
  if (!reply.ok) throw new Error(reply.error);
  return reply.page;
}

// ---- Timeline ---------------------------------------------------------------

function describeAction(a) {
  const target = a.label ? `“${a.label}”` : a.element_id;
  if (a.action === 'type') return `type “${a.value}” into ${target}`;
  if (a.action === 'select') return `select “${a.value}” in ${target}`;
  if (a.action === 'done') return 'finish';
  return `click ${target}`;
}

function addStep(html, { error = false } = {}) {
  const li = document.createElement('li');
  li.innerHTML = html;
  if (error) li.classList.add('error');
  $('timeline').appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
  return li;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

  try {
    const tab = await targetTab();
    if (!tab) throw new InfraError('No tab to work on');
    state.runTabId = tab.id;
    state.lastGoal = goal;
    state.lastStartUrl = tab.url;
    for (let step = 1; step <= MAX_STEPS && !state.stopRequested; step++) {
      const page = await snapshot(tab.id);
      const next = await api('/api/next-action', { method: 'POST', body: { goal, page, history, sessionId }, signal });
      const lesson = next.demoUsed ? '<span class="badge lesson">from lesson</span>' : '';
      addStep(`<b>${step}.</b> ${esc(describeAction(next))}${lesson}<div class="meta">${esc(next.reason)} · ${next.ms} ms</div>`, { error: !next.valid });

      if (next.action === 'done') { finished = true; break; }
      if (!next.valid) { failure = 'I picked an element that is not on the page.'; break; }

      const repeats = history.filter(h => h.action === next.action && h.label === next.label && h.value === next.value).length;
      if (repeats >= 2) { failure = `I kept repeating “${next.label}”.`; break; }

      if (next.role === 'button' && RISKY.test(next.label || '')) {
        const gate = await api('/api/safety-gate', { method: 'POST', body: { goal, action: next, element: { label: next.label, role: next.role }, sessionId }, signal });
        if (!gate.allow) { failure = `Safety gate blocked “${next.label}”: ${gate.reason}`; break; }
      }

      const result = await send(tab.id, { type: 'showme:act', action: next });
      if (!result.ok) { failure = result.error; break; }
      history.push({ action: next.action, label: next.label, role: next.role, value: next.value, element_id: next.element_id });
      await sleep(600);
    }

    if (state.stopRequested) failure = 'Stopped.';
    else if (!failure && !finished) failure = `I ran out of steps (${MAX_STEPS}).`;

    if (!failure) {
      await sleep(400);
      const check = await api('/api/done-check', { method: 'POST', body: { goal, page: await snapshot(tab.id), sessionId }, signal });
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

  if (failure) {
    setVerdict(false, failure === 'Stopped.' ? 'Stopped' : infra ? 'Error — not the agent\'s fault, so nothing to teach' : 'Failed');
    if (failure !== 'Stopped.' && !infra) offerTeaching(failure);
  } else {
    setVerdict(true, 'Done ✓');
  }
}

// ---- Teaching ("show me") -----------------------------------------------------

function offerTeaching(reason) {
  $('teach').hidden = false;
  $('teach-ask').hidden = false;
  $('teach-recording').hidden = true;
  $('teach-saved').hidden = true;
  $('teach-reason').textContent = reason;
}

async function startTeaching() {
  const tab = await tabById(state.runTabId);
  // Start the demonstration from the page the run started on.
  if (state.lastStartUrl && tab.url !== state.lastStartUrl) await chrome.tabs.update(tab.id, { url: state.lastStartUrl });
  else await chrome.tabs.reload(tab.id);
  await sleep(300);
  await waitForLoad(tab.id);
  state.recording = true;
  state.recorded = [];
  state.recordTabId = tab.id;
  $('recorded').innerHTML = '';
  $('done-teaching').disabled = true;
  $('teach-ask').hidden = true;
  $('teach-recording').hidden = false;
  await send(tab.id, { type: 'showme:record', on: true });
}

function onRecorded(step) {
  if (!state.recording) return;
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
    const { training } = await api('/api/demonstrations', {
      method: 'POST', body: { goal: state.lastGoal, url: steps[0].page.url, steps },
    });
    const where = training.viaMubit ? 'through Mubit' : 'to the mock model (no Mubit key, so nothing was recorded)';
    $('saved-summary').innerHTML =
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

async function rerun() {
  resetRunUi();
  addStep('Reloading the page…');
  const tab = await tabById(state.runTabId);
  if (state.lastStartUrl) await chrome.tabs.update(tab.id, { url: state.lastStartUrl });
  await sleep(300);
  await waitForLoad(tab.id);
  await sleep(300);
  run(state.lastGoal);
}

// Keep recording across page navigations during a demonstration.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (state.recording && tabId === state.recordTabId && info.status === 'complete') {
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

// ---- Ledger -------------------------------------------------------------------

const money = n => (n == null ? '—' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

async function refreshLedger() {
  const box = $('ledger');
  try {
    const l = await api('/api/ledger');
    if (!l.tasks.length) { box.innerHTML = '<p class="muted">No calls yet. Run the agent first.</p>'; return; }
    const rows = l.tasks.map(t => `
      <tr>
        <td><b>${esc(t.task)}</b></td>
        <td>${t.live}</td>
        <td>${t.training}</td>
        <td>${t.sentToMubit}/${t.keptExamplesNeeded}<div class="bar"><span style="width:${Math.round(100 * t.towardsFirstTraining / t.keptExamplesNeeded)}%"></span></div></td>
        <td>${t.p50Ms ?? '—'}</td>
      </tr>`).join('');
    const next = l.tasks.find(t => t.task === 'next-action') || l.tasks[0];
    const m = next.monthlyAt50kPerDay;
    box.innerHTML = `
      <table>
        <thead><tr><th>Task</th><th>Live</th><th>Taught</th><th>Sent / 25</th><th>p50 ms</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted small">“Sent / 25” counts calls we sent; Mubit keeps only some of them as examples. Check the task's count in the console.</p>
      <div class="compare">
        <div><div class="muted small">${esc(next.model || l.model)} · per 1k decisions</div><div class="num">${money(next.providerCostPer1k)}</div><div class="muted small">p50 ${next.p50Ms ?? '—'} ms</div></div>
        <div><div class="muted small">Adapter (estimate) · per 1k</div><div class="num">${money(next.adapterCostPer1kEstimate)}</div><div class="muted small">p50 ~${next.adapterP50MsEstimate} ms</div></div>
      </div>
      ${m ? `<p class="small">At 50k decisions a day: <b>${money(m.provider)}</b>/month on the provider vs <b>${money(m.adapterEstimate)}</b> on the adapter (estimate).</p>` : '<p class="muted small">Costs appear once calls go through Mubit (mock calls are free and not counted).</p>'}`;
  } catch (err) {
    box.innerHTML = `<p class="muted">Backend offline: ${esc(err.message)}</p>`;
  }
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
  $('view-agent').hidden = view !== 'agent';
  $('view-ledger').hidden = view !== 'ledger';
  if (view === 'ledger') refreshLedger();
}

async function init() {
  const saved = await chrome.storage.local.get(['server', 'goal']);
  if (saved.server) state.server = saved.server;
  if (saved.goal) $('goal').value = saved.goal;
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
  $('refresh-ledger').addEventListener('click', refreshLedger);
  $('reset-ledger').addEventListener('click', async () => { await api('/api/ledger', { method: 'DELETE' }).catch(() => {}); refreshLedger(); });
  $('server').addEventListener('change', async () => {
    state.server = $('server').value.replace(/\/$/, '');
    await chrome.storage.local.set({ server: state.server });
    refreshHealth(); refreshMemory();
  });
  chrome.tabs.onActivated.addListener(updateTargetLabel);
  chrome.tabs.onUpdated.addListener((_id, info) => { if (info.title || info.status === 'complete') updateTargetLabel(); });

  updateTargetLabel();
  refreshHealth();
  refreshMemory();
  setInterval(refreshHealth, 15000);
}

init();
