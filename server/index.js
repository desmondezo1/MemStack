// Show Me backend. The extension talks to this server; this server talks to Mubit.
// Mubit's API refuses browser (CORS) calls and the key must stay off the client,
// so every model call goes through here.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.js';
import { TASKS, buildNextActionMessage, buildDoneCheckMessage, buildSafetyMessage } from './prompts.js';
import { callTask, getConfig, LlmError } from './llm.js';
import { addDemo, clearDemos, listDemos, recallDemo } from './memory.js';
import { clearCalls, ledgerStats } from './ledger.js';

loadEnv();

const PORT = Number(process.env.PORT || 8787);
const DEMO_SITE = path.resolve(import.meta.dirname, 'demo-site');

const routes = {
  'GET /api/health': async () => {
    const { provider, model, baseUrl } = getConfig();
    return { ok: true, provider, model, viaMubit: provider !== 'mock', baseUrl: provider === 'mock' ? null : baseUrl };
  },

  'POST /api/next-action': async ({ goal, page, history, sessionId }) => {
    requireFields({ goal, page, sessionId });
    if (!Array.isArray(page.elements)) throw httpError(400, 'page.elements must be an array');
    if (history !== undefined && !Array.isArray(history)) throw httpError(400, 'history must be an array');
    history = history || [];
    const demo = recallDemo({ url: page.url, goal });
    const userMessage = buildNextActionMessage({ goal, page, history, demo });
    const { json, ms, requestId, usage } = await callTask({
      task: TASKS.nextAction, userMessage, sessionId, mockContext: { goal, page, history, demo },
    });
    const action = normaliseAction(json, page);
    return { ...action, ms, requestId, usage, demoUsed: demo ? { id: demo.id, goal: demo.goal } : null };
  },

  'POST /api/done-check': async ({ goal, page, sessionId }) => {
    requireFields({ goal, page, sessionId });
    const { json, ms, requestId, usage } = await callTask({
      task: TASKS.doneCheck, userMessage: buildDoneCheckMessage({ goal, page }), sessionId, mockContext: { goal, page },
    });
    return { done: json.done === true, reason: String(json.reason || ''), ms, requestId, usage };
  },

  'POST /api/safety-gate': async ({ goal, action, element, sessionId }) => {
    requireFields({ goal, action, sessionId });
    const { json, ms, requestId, usage } = await callTask({
      task: TASKS.safetyGate, userMessage: buildSafetyMessage({ goal, action, element }), sessionId, mockContext: { goal, action, element },
    });
    return { allow: json.allow !== false, reason: String(json.reason || ''), ms, requestId, usage };
  },

  'GET /api/demonstrations': async () => ({ demos: listDemos() }),

  'DELETE /api/demonstrations': async () => { clearDemos(); return { ok: true }; },

  // A finished "show me": store it in memory, then re-send every step through Mubit
  // as a next-action call with the demonstration recalled, so each step becomes a
  // recorded example of the next-action task.
  'POST /api/demonstrations': async ({ goal, url, steps }) => {
    requireFields({ goal, url, steps });
    if (!Array.isArray(steps) || !steps.length) throw httpError(400, 'steps must be a non-empty array');
    if (steps.some(s => !s || !s.page || !Array.isArray(s.page.elements) || !s.action)) {
      throw httpError(400, 'each step needs an action and the page it happened on');
    }
    const demo = addDemo({ goal, url, steps });
    const sessionId = `demo-${demo.id}`;
    const results = await mapLimit(steps, 4, async (step, i) => {
      const history = steps.slice(0, i).map(s => ({ action: s.action, label: s.label, role: s.role, value: s.value }));
      const userMessage = buildNextActionMessage({ goal, page: step.page, history, demo });
      try {
        const { json } = await callTask({
          task: TASKS.nextAction, userMessage, sessionId, kind: 'training',
          mockContext: { goal, page: step.page, history, demo },
        });
        const chosen = (step.page.elements || []).find(e => e.id === json.element_id);
        const agreed = json.action === step.action && (step.label ? !!chosen && sameText(chosen.label, step.label) : sameText(json.value, step.value));
        return { step: i + 1, agreed, provider: { action: json.action, label: chosen?.label ?? null } };
      } catch (err) {
        return { step: i + 1, agreed: false, error: err.message };
      }
    });
    return {
      demo,
      training: {
        viaMubit: getConfig().provider !== 'mock',
        sent: results.filter(r => !r.error).length,
        agreed: results.filter(r => r.agreed).length,
        errors: results.filter(r => r.error).length,
        results,
      },
    };
  },

  'GET /api/ledger': async () => ledgerStats(getConfig()),

  'DELETE /api/ledger': async () => { clearCalls(); return { ok: true }; },
};

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

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

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
    console.error(`Port ${PORT} is already in use: a Show Me server is probably already running.`);
    console.error(`Stop it (Ctrl+C in its terminal, or: lsof -ti tcp:${PORT} | xargs kill), or start on another port: PORT=8788 npm start`);
    process.exit(1);
  });
  server.listen(PORT, () => {
    const { provider, model } = getConfig();
    const mode = provider === 'mock' ? 'MOCK model (no MUBIT_API_KEY set)' : `${provider} / ${model} via Mubit`;
    console.log(`Show Me server on http://localhost:${PORT}  ·  ${mode}`);
    console.log(`Demo site: http://localhost:${PORT}/demo/`);
  });
}
