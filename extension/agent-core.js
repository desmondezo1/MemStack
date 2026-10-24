// The agent loop and its browser plumbing, shared by the side panel (runs you can watch)
// and the background worker (voice runs while the panel is closed). Everything here uses
// only chrome.tabs / chrome.scripting / fetch, which both places have.

export const MAX_STEPS = 20;
export const RISKY = /pay|purchase|buy now|place order|delete|remove|transfer|send|submit|confirm|reserve|book/i;

// Errors from the backend, Mubit or the provider. They are not the agent's mistakes,
// so they never trigger "show me".
export class InfraError extends Error {}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const isOwnPage = url => !url || url.startsWith(chrome.runtime.getURL(''));
export const isWebPage = url => /^(https?|file):/.test(url || '');

export async function getServer() {
  const { server } = await chrome.storage.local.get('server');
  return (server || 'http://localhost:8787').replace(/\/$/, '');
}

export function createApi(serverOf) {
  return async function api(path, { method = 'GET', body, signal } = {}) {
    const server = await serverOf();
    let res;
    try {
      res = await fetch(`${server}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new InfraError(`Backend offline at ${server}. Start it with: npm start`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data.agentError) throw new Error(`I gave an answer I couldn't act on (${data.error.slice(0, 120)}…)`);
    if (!res.ok) throw new InfraError(data.error || `${res.status} ${res.statusText}`);
    return data;
  };
}

export async function waitForLoad(tabId, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
    await sleep(150);
  }
  throw new InfraError('The page took too long to load');
}

export async function send(tabId, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const reply = await chrome.tabs.sendMessage(tabId, message);
      if (reply) return reply;
    } catch {
      // No content script yet (page opened before the extension loaded, or mid-navigation).
      await waitForLoad(tabId).catch(() => {});
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js', 'mascot.js'] }).catch(() => {});
      await sleep(150);
    }
  }
  throw new InfraError('Show Me cannot read this page (try reloading it; chrome:// pages are off limits)');
}

export async function snapshot(tabId) {
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

export function shortUrl(url) {
  try { const u = new URL(url); return (u.host + u.pathname + u.search).replace(/\/$/, '').slice(0, 60); } catch { return String(url).slice(0, 60); }
}

export function describeAction(a) {
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

// Mo on the page shows what the agent is doing.
export function mo(tabId, state, extra = {}) {
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'showme:mo', state, ...extra }).catch(() => {});
}

// Actions the browser does itself; the rest happen inside the page.
export async function perform(tabId, action) {
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

// One run of the agent on a tab. `ui` callbacks let the caller show progress
// (the panel draws a timeline; the background lets Mo narrate):
//   step(next) → handle, failedStep(handle), navigated(handle, url), check(check), error(message), usage(usage, ms)
export async function runAgent({ goal, tabId, api, signal, isStopped = () => false, ui = {} }) {
  const r = {
    goal, tabId, sessionId: `run-${Date.now()}`, history: [], runSteps: [],
    failure: null, infra: false, finished: false, asked: false, usedLesson: false, decisions: 0, invalid: 0,
  };
  const call = (fn, ...args) => (ui[fn] ? ui[fn](...args) : undefined);
  try {
    for (let step = 1; step <= MAX_STEPS && !isStopped(); step++) {
      const page = await snapshot(tabId);
      mo(tabId, 'thinking');
      const next = await api('/api/next-action', { method: 'POST', body: { goal, page, history: r.history, sessionId: r.sessionId }, signal });
      call('usage', next.usage, next.ms);
      r.decisions++;
      if (!next.valid) r.invalid++;
      if (next.demoUsed) r.usedLesson = true;
      const handle = call('step', next);

      if (next.action === 'done') { r.finished = true; break; }
      if (!next.valid) { r.failure = next.action === 'open_url' ? 'I tried to open an address that is not a web URL.' : 'I picked an element that is not on the page.'; break; }
      if (next.action === 'ask_human') { r.failure = `I need help: ${next.value || next.reason}`; r.asked = true; break; }

      const same = h => h.action === next.action && h.label === next.label && h.value === next.value;
      const limit = next.action === 'scroll' || next.action === 'wait' ? 4 : 2;
      if (r.history.filter(same).length >= limit) { r.failure = `I kept repeating “${describeAction(next)}”.`; break; }

      if ((next.role === 'button' || next.role === 'link') && RISKY.test(next.label || '')) {
        const gate = await api('/api/safety-gate', { method: 'POST', body: { goal, action: next, element: { label: next.label, role: next.role }, evidence: page.text, sessionId: r.sessionId }, signal });
        call('usage', gate.usage, gate.ms);
        if (!gate.allow) { r.failure = `Safety gate blocked “${next.label}”: ${gate.reason}`; break; }
      }

      const before = (await chrome.tabs.get(tabId)).url;
      mo(tabId, 'acting', { targetId: next.element_id, text: describeAction(next) });
      const result = await perform(tabId, next);
      if (!result.ok) { r.failure = result.error; call('failedStep', handle); break; }
      const entry = { action: next.action, label: next.label, role: next.role, value: next.value, submit: next.submit, element_id: next.element_id };
      r.history.push(entry);
      r.runSteps.push({ ...entry, handle });
      await sleep(next.action === 'wait' ? 1500 : 600);
      const after = await waitForLoad(tabId).catch(() => null);
      if (after && after.url !== before) call('navigated', handle, after.url);
    }

    if (isStopped()) r.failure = 'Stopped.';
    else if (!r.failure && !r.finished) r.failure = `I ran out of steps (${MAX_STEPS}).`;

    if (!r.failure) {
      await sleep(400);
      const check = await api('/api/done-check', { method: 'POST', body: { goal, page: await snapshot(tabId), sessionId: r.sessionId }, signal });
      call('usage', check.usage, check.ms);
      call('check', check);
      if (!check.done) r.failure = check.reason || 'The page does not show the goal as done.';
    }
  } catch (err) {
    if (err.name === 'AbortError' || isStopped()) {
      r.failure = 'Stopped.';
    } else {
      r.failure = err.message;
      r.infra = err instanceof InfraError;
      call('error', err.message);
    }
  }
  r.outcome = !r.failure ? 'done' : r.failure === 'Stopped.' ? 'stopped' : r.infra ? 'error' : r.asked ? 'asked' : 'failed';
  const finalTab = await chrome.tabs.get(tabId).catch(() => null);
  r.finalUrl = finalTab?.url || null;
  // Every run is recorded for the Mubit tab's "failures that became fixes".
  api('/api/runs', { method: 'POST', body: {
    goal, outcome: r.outcome, usedLesson: r.usedLesson, steps: r.history.length, decisions: r.decisions, invalid: r.invalid,
    tools: [...new Set(r.history.map(h => h.action).concat(r.finished ? ['done'] : []))], url: r.finalUrl,
  } }).catch(() => {});
  return r;
}
