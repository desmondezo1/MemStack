// Mo's backend. The extension talks to this server; this server talks to Mubit.
// Mubit's API refuses browser (CORS) calls and the key must stay off the client,
// so every model call goes through here.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.js';
import { TASKS, buildNextActionMessage, buildDoneCheckMessage, buildSafetyMessage, buildLocateMessage, buildRefineMessage } from './prompts.js';
import { findDetours, forTraining } from './refine.js';
import { callTask, getConfig, LlmError } from './llm.js';
import { formatStep } from './prompts.js';
import { addDemo, clearDemos, deleteSkill, listDemos, listSkills, recallDemo, renameSkill, updateDemo } from './memory.js';
import { verifyDone, verifySafe, verifierEnabled } from './verifier.js';
import { signals as linkSignals, localVerdict, domainAgeDays, loadFeed, feedSize, memory as guardMemory, linkMessage, explain, brandFor, evalResults, MODEL_THRESHOLD } from './guard.js';
import { clearCalls, ledgerStats, recentCalls, addRun, readRuns, getSettings, saveSettings, onEvent, emit } from './ledger.js';

loadEnv();

const PORT = Number(process.env.PORT || 8787);

// A sheet skill keeps its columns and the rule for each form field, never the rows themselves.
function cleanSheet(sheet) {
  if (!sheet || !Array.isArray(sheet.rules)) return undefined;
  const str = (v, n) => String(v ?? '').slice(0, n);
  return {
    columns: Array.isArray(sheet.columns) ? sheet.columns.slice(0, 40).map(c => str(c, 80)) : [],
    startUrl: str(sheet.startUrl, 500),
    submit: str(sheet.submit, 120),
    rules: sheet.rules.slice(0, 40).map(r => ({
      label: str(r.label, 120), role: str(r.role, 20), action: str(r.action, 10), type: str(r.type, 12),
      column: str(r.column, 80), value: str(r.value, 200), note: str(r.note, 300), kind: str(r.kind, 30),
      days: Number(r.days) || 0, format: str(r.format, 12), options: Array.isArray(r.options) ? r.options.slice(0, 60).map(o => str(o, 80)) : [],
    })),
  };
}
const DEMO_SITE = path.resolve(import.meta.dirname, 'demo-site');

const routes = {
  'GET /api/health': async () => {
    const { provider, model, baseUrl } = getConfig();
    return { ok: true, provider, model, viaMubit: provider !== 'mock', baseUrl: provider === 'mock' ? null : baseUrl };
  },

  'POST /api/next-action': async ({ goal, page, history, sessionId, skill }) => {
    requireFields({ goal, page, sessionId });
    if (!Array.isArray(page.elements)) throw httpError(400, 'page.elements must be an array');
    if (history !== undefined && !Array.isArray(history)) throw httpError(400, 'history must be an array');
    history = history || [];
    const demo = recallDemo({ url: page.url, goal, skill });
    const userMessage = buildNextActionMessage({ goal, page, history, demo });
    const { json, ms, requestId, usage } = await callTask({
      task: TASKS.nextAction, userMessage, sessionId, mockContext: { goal, page, history, demo },
      summarize: j => describeChoice(j, page),
    });
    const action = normaliseAction(json, page);
    return { ...action, ms, requestId, usage, demoUsed: demo ? { id: demo.id, goal: demo.goal, skill: demo.skill || demo.goal } : null };
  },

  // Claude's check (through Mubit) and Sapling's independent check run side by side;
  // a Sapling "fail" overrides a "goal met", which sends the user to "Show me".
  'POST /api/done-check': async ({ goal, page, sessionId }) => {
    requireFields({ goal, page, sessionId });
    const [{ json, ms, requestId, usage }, sapling] = await Promise.all([
      callTask({
        task: TASKS.doneCheck, userMessage: buildDoneCheckMessage({ goal, page }), sessionId, mockContext: { goal, page },
        summarize: j => (j.done ? 'goal met' : `goal not met: ${j.reason || problemText(j.problem)}`),
      }),
      verifierEnabled() ? verifyDone({ goal, pageText: page.text }) : null,
    ]);
    const vetoed = json.done === true && sapling?.verdict === 'fail';
    const reason = vetoed ? `The verifier disagrees: the page doesn't show "${goal}" was done`
      : String(json.reason || (json.done ? 'The page shows the goal is done' : problemText(json.problem)));
    return { done: json.done === true && !vetoed, reason, ms, requestId, usage, verifier: sapling };
  },

  // Before a submit/pay/delete click. evidence = the visible text of the form or page.
  'POST /api/safety-gate': async ({ goal, action, element, sessionId, evidence, constraints }) => {
    requireFields({ goal, action, sessionId });
    const [{ json, ms, requestId, usage }, sapling] = await Promise.all([
      callTask({
        task: TASKS.safetyGate, userMessage: buildSafetyMessage({ goal, action, element }), sessionId, mockContext: { goal, action, element },
        summarize: j => `${j.allow === false ? 'blocked' : 'allowed'}: ${j.reason || ''}`,
      }),
      verifierEnabled() ? verifySafe({ goal, constraints, evidence: evidence || `${element?.label || ''} ${goal}` }) : null,
    ]);
    const blocked = !!sapling?.block;
    const reason = blocked ? `The verifier scored this click unsafe (${Math.round(sapling.safeScore * 100)}% safe)` : String(json.reason || '');
    return { allow: json.allow !== false && !blocked, reason, ms, requestId, usage, verifier: sapling };
  },

  // A question about the page: which block answers it, and the answer in one sentence.
  'POST /api/locate': async ({ goal, page, sessionId }) => {
    requireFields({ goal, page, sessionId });
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    const demo = recallDemo({ url: page.url, goal });
    const hint = demo?.answers?.find(a => a.page === undefined || a.page === pageKeyOf(page.url))?.value;
    const { json, ms, requestId, usage } = await callTask({
      task: TASKS.locate, userMessage: buildLocateMessage({ goal, page, hint }), sessionId, mockContext: { goal, page, hint },
      summarize: j => (j.found ? `found: ${j.answer || ''}` : 'not on this page'),
    });
    const block = blocks.find(b => b.id === json.block_id) || (page.elements || []).find(e => e.id === json.block_id);
    const found = json.found === true && !!block;
    return { found, block_id: found ? json.block_id : '', answer: found ? String(json.answer || block.text || block.label) : '', ms, requestId, usage, demoUsed: hint ? { id: demo.id } : null };
  },

  // Before a lesson trains anything: which steps were detours? Rules first, then the model.
  'POST /api/refine-lesson': async ({ goal, steps, sessionId = `refine-${Date.now()}` }) => {
    requireFields({ goal, steps });
    if (!Array.isArray(steps)) throw httpError(400, 'steps must be an array');
    const detours = findDetours(steps);
    const why = Object.fromEntries([...detours.drop].map(i => [i, detours.why[i]]));
    let model = null;
    if (steps.length > 1) {
      try {
        const { json } = await callTask({
          task: TASKS.refineLesson, userMessage: buildRefineMessage({ goal, steps }), sessionId, mockContext: { detours },
          summarize: j => `drop ${(j.drop || []).join(', ') || 'nothing'}`,
        });
        model = json;
        for (const n of Array.isArray(json.drop) ? json.drop : []) {
          const i = Number(n) - 1;
          // The model may not drop the last step: that's the one that reached the goal.
          if (Number.isInteger(i) && i >= 0 && i < steps.length - 1 && !(i in why)) why[i] = String(json.why?.[n] || 'Not needed for the goal');
        }
      } catch { /* the rules alone are still a good suggestion */ }
    }
    return { keep: steps.map((_, i) => !(i in why)), why, modelUsed: !!model };
  },

  'GET /api/demonstrations': async () => ({ demos: listDemos() }),

  'DELETE /api/demonstrations': async () => { clearDemos(); return { ok: true }; },

  // A finished "show me": store it in memory, then re-send every step through Mubit
  // as a next-action call with the demonstration recalled, so each step becomes a
  // recorded example of the next-action task.
  'GET /api/skills': async () => {
    const runs = readRuns();
    return { skills: listSkills().map(s => {
      const mine = runs.filter(r => r.skill === s.name);
      return { ...s, runs: mine.length, lastRun: mine[mine.length - 1]?.ts || null, lastOutcome: mine[mine.length - 1]?.outcome || null };
    }) };
  },
  'POST /api/skills/delete': async ({ name }) => { requireFields({ name }); deleteSkill(String(name)); return { ok: true }; },
  'POST /api/skills/rename': async ({ name, to }) => { requireFields({ name, to }); renameSkill(String(name), String(to)); return { ok: true }; },

  'POST /api/demonstrations': async ({ goal, url, steps, mistake, skill, sheet }) => {
    requireFields({ goal, url, steps });
    if (!Array.isArray(steps) || !steps.length) throw httpError(400, 'steps must be a non-empty array');
    if (steps.some(s => !s || !s.page || !Array.isArray(s.page.elements) || !s.action)) {
      throw httpError(400, 'each step needs an action and the page it happened on');
    }
    // Pointing at the answer trains "locate"; tab steps become plain page opens.
    const answers = steps.filter(s => s.action === 'highlight');
    steps = forTraining(steps.filter(s => s.action !== 'highlight'));
    const demo = addDemo({ goal, url, steps, mistake, answers, skill, sheet: cleanSheet(sheet) });
    const sessionId = `demo-${demo.id}`;
    const locateResults = await mapLimit(answers, 2, async a => {
      try {
        const { json } = await callTask({
          task: TASKS.locate, userMessage: buildLocateMessage({ goal, page: a.page, hint: a.value }), sessionId, kind: 'training',
          mockContext: { goal, page: a.page, hint: a.value }, summarize: () => `taught answer: ${a.value.slice(0, 60)}`,
        });
        return { agreed: json.block_id === a.element_id };
      } catch (err) {
        return { agreed: false, error: err.message };
      }
    });
    const results = await mapLimit(steps, 4, async (step, i) => {
      const history = steps.slice(0, i).map(s => ({ action: s.action, label: s.label, role: s.role, value: s.value }));
      const userMessage = buildNextActionMessage({ goal, page: step.page, history, demo });
      try {
        const { json } = await callTask({
          task: TASKS.nextAction, userMessage, sessionId, kind: 'training',
          mockContext: { goal, page: step.page, history, demo },
          summarize: () => `taught step ${i + 1} of ${steps.length}: ${formatStep(step)}`,
        });
        const chosen = (step.page.elements || []).find(e => e.id === json.element_id);
        const agreed = json.action === step.action && (step.label ? !!chosen && sameText(chosen.label, step.label) : sameText(json.value, step.value));
        return { step: i + 1, agreed, provider: { action: json.action, label: chosen?.label ?? null } };
      } catch (err) {
        return { step: i + 1, agreed: false, error: err.message };
      }
    });
    const all = [...results, ...locateResults];
    const training = {
      viaMubit: getConfig().provider !== 'mock',
      sent: all.filter(r => !r.error).length,
      agreed: all.filter(r => r.agreed).length,
      errors: all.filter(r => r.error).length,
      results,
    };
    const saved = updateDemo(demo.id, { training: { viaMubit: training.viaMubit, sent: training.sent, agreed: training.agreed, errors: training.errors } });
    emit('lesson', saved);
    return { demo: saved, training };
  },

  'GET /api/calls': async () => ({ calls: recentCalls(60) }),

  // The panel reports how each run ended, for "failures → improvements".
  'POST /api/runs': async ({ goal, outcome, usedLesson, steps, tools, url, mistake, decisions, invalid, skill, row }) => {
    requireFields({ goal, outcome });
    if (!['done', 'failed', 'asked', 'error', 'stopped'].includes(outcome)) throw httpError(400, 'unknown outcome');
    return addRun({
      goal: String(goal).slice(0, 200), outcome, usedLesson: !!usedLesson, steps: Number(steps) || 0,
      tools: Array.isArray(tools) ? tools.slice(0, 20).map(String) : [], url: url ? String(url).slice(0, 300) : null,
      mistake: mistake ? String(mistake).slice(0, 300) : null,
      decisions: Number(decisions) || 0, invalid: Number(invalid) || 0,
      ...(skill ? { skill: String(skill).slice(0, 80) } : {}), ...(row ? { row: Number(row) || null } : {}),
    });
  },

  'GET /api/runs': async () => ({ runs: readRuns().slice(-200) }),

  'GET /api/settings': async () => getSettings(),

  'POST /api/settings': async body => saveSettings(body),

  // Everything the Mubit and Judges tabs draw, in one request.
  'GET /api/overview': async () => {
    const config = getConfig();
    return {
      health: { provider: config.provider, model: config.model, viaMubit: config.provider !== 'mock' },
      ledger: ledgerStats(config),
      calls: recentCalls(40),
      runs: readRuns().slice(-200),
      lessons: listDemos().map(d => ({ id: d.id, goal: d.goal, steps: d.steps.length, createdAt: d.createdAt, training: d.training || null, mistake: d.mistake || null })),
      settings: getSettings(),
      guard: guardOverview(),
    };
  },

  // Mo Guard: check the page itself and the links on it.
  'POST /api/guard/check': async ({ pageUrl, links, hasPassword }) => {
    requireFields({ pageUrl });
    if (links !== undefined && !Array.isArray(links)) throw httpError(400, 'links must be an array');
    const feed = await loadFeed();
    const pageHost = hostOf(pageUrl);
    const items = [{ url: String(pageUrl), text: '', kind: 'page' }, ...(links || []).slice(0, 100).map(l => ({ url: String(l?.url || ''), text: String(l?.text || '').slice(0, 120), kind: 'link' }))];
    const seen = new Set();
    const unique = items.filter(i => i.url && !seen.has(i.kind + i.url) && seen.add(i.kind + i.url));
    const results = (await mapLimit(unique, 4, i => checkLink(i, { pageHost, hasPassword: i.kind === 'page' && !!hasPassword, feed }))).filter(Boolean);
    guardStats.checked += results.length;
    guardStats.flagged += results.filter(r => r.verdict !== 'safe').length;
    return { results };
  },

  // "This is fine" / "This is phishing": remembered for the site, and sent through Mubit as
  // a training example of the link-check task.
  'POST /api/guard/feedback': async ({ url, verdict, text, pageUrl }) => {
    requireFields({ url, verdict });
    if (!['safe', 'phishing'].includes(verdict)) throw httpError(400, 'verdict must be safe or phishing');
    const pageHost = hostOf(pageUrl);
    const s = linkSignals({ url: String(url), text: String(text || ''), pageHost, feed: await loadFeed() });
    if (!s.ok) throw httpError(400, 'not a web address');
    guardMemory.set(s.host, verdict);
    guardCache.clear();
    let training;
    try {
      const r = await callTask({
        task: TASKS.linkCheck, userMessage: linkMessage(s, { text, pageHost, reviewed: verdict }), sessionId: `guard-review-${s.domain}`,
        kind: 'training', mockContext: { signals: s, reviewed: verdict }, summarize: () => `reviewed as ${verdict}: ${s.host}`,
      });
      training = { sent: true, agreed: r.json.verdict === verdict, viaMubit: getConfig().provider !== 'mock' };
    } catch (err) {
      training = { sent: false, error: err.message };
    }
    guardStats.corrections++;
    emit('guard', { host: s.host, verdict });
    return { ok: true, host: s.host, verdict, training };
  },

  'GET /api/guard/stats': async () => guardOverview(),

  'GET /api/ledger': async () => ledgerStats(getConfig()),

  'DELETE /api/ledger': async () => { clearCalls(); return { ok: true }; },
};

// ---- Mo Guard ------------------------------------------------------------------------

const hostOf = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
const guardCache = new Map(); // "kind|url|password" → { at, result }, for an hour
const guardStats = { checked: 0, flagged: 0, corrections: 0 };

function guardOverview() {
  return { ...guardStats, remembered: Object.keys(guardMemory.all()).length, feedHosts: feedSize(), eval: evalResults() };
}

// One link: rules first; Claude through Mubit only when the rules find it risky.
async function checkLink(item, { pageHost, hasPassword, feed }) {
  const key = `${item.kind}|${item.url}|${hasPassword}`;
  const hit = guardCache.get(key);
  if (hit && Date.now() - hit.at < 3600e3) return hit.result;
  // A page is judged on its own address, not trusted for being on itself.
  const base = { url: item.url, text: item.text, pageHost: item.kind === 'page' ? '' : pageHost, hasPassword, feed };
  let s = linkSignals(base);
  if (!s.ok) return null;
  const remembered = guardMemory.get(s.host);
  let verdict = localVerdict(s.score);
  let pretendsTo = s.pretendsTo;
  let source = 'rules';
  let call = null;
  if (remembered) {
    verdict = remembered;
    source = 'you';
  } else {
    // Domain age only matters for addresses that already look off.
    if (s.signals.length && !s.trusted) s = linkSignals({ ...base, ageDays: await domainAgeDays(s.domain) });
    verdict = localVerdict(s.score);
    if (s.score >= MODEL_THRESHOLD) {
      try {
        const r = await callTask({
          task: TASKS.linkCheck, userMessage: linkMessage(s, { text: item.text, pageHost }), sessionId: `guard-${s.domain}`,
          mockContext: { signals: s }, summarize: j => `${j.verdict}${j.pretends_to_be ? ` (imitates ${j.pretends_to_be})` : ''}: ${s.host}`,
        });
        if (['safe', 'suspicious', 'phishing'].includes(r.json.verdict)) { verdict = r.json.verdict; source = 'claude'; }
        if (r.json.pretends_to_be) pretendsTo = String(r.json.pretends_to_be).replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').toLowerCase();
        call = { ms: r.ms, usage: r.usage, requestId: r.requestId };
      } catch { /* the rules decide when the model can't answer */ }
    }
    if (s.signals.includes('known_phishing')) verdict = 'phishing';
  }
  if (verdict === 'safe') pretendsTo = null;
  const realSite = pretendsTo ? `https://${pretendsTo.split('.').length > 2 ? pretendsTo : `www.${pretendsTo}`}` : null;
  const result = {
    url: item.url, kind: item.kind, host: s.host, verdict, score: s.score, signals: s.signals,
    reasons: explain(s.signals, pretendsTo), pretendsTo, brand: pretendsTo ? (brandFor(pretendsTo)?.name || pretendsTo) : null, realSite, source, ...call,
  };
  guardCache.set(key, { at: Date.now(), result });
  return result;
}

const pageKeyOf = url => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return url; } };

// done-check answers with a fixed problem code; this is what the panel and Mo say for it.
const PROBLEMS = {
  wrong_time: 'It went through, but at a different time than you asked for',
  wrong_date: 'It went through, but for a different day than you asked for',
  wrong_count: 'It went through, but for a different number or amount than you asked for',
  wrong_name: 'It went through, but with a different name or email than you asked for',
  wrong_item: 'It ended on a different item than you asked for',
  no_confirmation: 'The page shows no confirmation that it worked',
  error: 'The page shows an error',
};
export function problemText(code) {
  return PROBLEMS[code] || 'The page does not show the goal as done';
}

function describeChoice(json, page) {
  const element = (page.elements || []).find(e => e.id === json.element_id);
  return formatStep({ ...json, label: element?.label, role: element?.role });
}

const NEEDS_ELEMENT = new Set(['click', 'type', 'select']);
const PAGE_ACTIONS = new Set(['back', 'wait', 'ask_human', 'done']);
const KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp']);

// Checks the model's choice against the page, so the extension never acts on a made-up element or URL.
export function normaliseAction(json, page) {
  const action = String(json.action || '').toLowerCase();
  const elementId = String(json.element_id || '');
  const element = (page.elements || []).find(e => e.id === elementId) || null;
  let value = json.value == null ? '' : String(json.value);
  let valid = false;
  if (NEEDS_ELEMENT.has(action)) valid = !!element;
  else if (PAGE_ACTIONS.has(action)) valid = true;
  else if (action === 'scroll') { value = /up/i.test(value) ? 'up' : 'down'; valid = true; }
  else if (action === 'press') valid = KEYS.has(value) && (!elementId || !!element);
  else if (action === 'open_url') {
    if (value && !/^[a-z]+:/i.test(value)) value = `https://${value}`;
    try { valid = ['http:', 'https:'].includes(new URL(value).protocol); } catch { valid = false; }
  }
  return {
    action, element_id: element ? elementId : '', value, submit: json.submit === true,
    reason: String(json.reason || ''), label: element?.label ?? null, role: element?.role ?? null, valid,
  };
}

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function requireFields(fields) {
  const missing = Object.entries(fields).filter(([, v]) => v === undefined || v === null || v === '').map(([k]) => k);
  if (missing.length) throw httpError(400, `Missing: ${missing.join(', ')}`);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Server-sent events: the side panel's live feed of calls, runs and lessons.
function streamEvents(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  });
  res.write(': connected\n\n');
  const off = onEvent((type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { off(); clearInterval(ping); });
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw httpError(413, 'Body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'Body is not JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Body must be a JSON object');
  return body;
}

// .csv as plain text, so a CSV attachment opens as a page in the browser instead of downloading.
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.csv': 'text/plain; charset=utf-8' };

function serveStatic(res, urlPath) {
  const rel = urlPath.replace(/^\/demo\/?/, '') || 'index.html';
  let file = path.resolve(DEMO_SITE, rel);
  if (file.startsWith(DEMO_SITE) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(DEMO_SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'Not found' });
  send(res, 200, fs.readFileSync(file), STATIC_TYPES[path.extname(file)] || 'application/octet-stream');
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
    if (url.pathname === '/') { res.writeHead(302, { location: '/demo/' }); return res.end(); }
    if (req.method === 'GET' && url.pathname.startsWith('/demo')) return serveStatic(res, url.pathname);
    if (req.method === 'GET' && url.pathname === '/api/events') return streamEvents(req, res);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'Not found' });
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      send(res, 200, await handler(body));
    } catch (err) {
      // Our own validation errors keep their status; anything from Mubit or the provider is a 502.
      // A garbled model answer is the agent's mistake (422, teachable); a failed call is infrastructure (502).
      const status = err.code === 'bad_reply' ? 422 : err instanceof LlmError ? 502 : (err.status || 500);
      console.error(`[show-me] ${req.method} ${url.pathname}: ${err.message}`);
      send(res, status, { error: err.message, requestId: err.requestId || null, agentError: err.code === 'bad_reply' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const server = createServer();
  server.on('error', err => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`Port ${PORT} is already in use: a Mo server is probably already running.`);
    console.error(`Stop it (Ctrl+C in its terminal, or: lsof -ti tcp:${PORT} | xargs kill), or start on another port: PORT=8788 npm start`);
    process.exit(1);
  });
  server.listen(PORT, () => {
    const { provider, model } = getConfig();
    const mode = provider === 'mock' ? 'MOCK model (no MUBIT_API_KEY set)' : `${provider} / ${model} via Mubit`;
    console.log(`Mo server on http://localhost:${PORT}  ·  ${mode}`);
    console.log(`Demo site: http://localhost:${PORT}/demo/`);
  });
}
