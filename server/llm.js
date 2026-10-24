// Every model call goes through here. With a Mubit key, calls go to the provider
// through Mubit's gateway, so Mubit records them and trains adapters per task.
// Without a key, a deterministic mock answers so the whole flow can be tested offline.

import { SYSTEM_PROMPTS } from './prompts.js';
import { mockAnswer } from './mock.js';
import { logCall, costOf } from './ledger.js';

export function getConfig() {
  const key = process.env.MUBIT_API_KEY || '';
  let provider = (process.env.MUBIT_PROVIDER || 'anthropic').toLowerCase();
  if (!key || process.env.SHOWME_MOCK === '1') provider = 'mock';
  const defaults = { anthropic: 'claude-haiku-5-5', openai: 'gpt-6-luna', mock: 'mock-agent' };
  return {
    provider,
    model: provider === 'mock' ? 'mock-agent' : (process.env.MUBIT_MODEL || defaults[provider]),
    baseUrl: (process.env.MUBIT_BASE_URL || 'https://api.mubit.ai').replace(/\/$/, ''),
    key,
  };
}

export class LlmError extends Error {
  constructor(message, { status, code, requestId } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

// task: one of TASKS. kind: 'live' (agent run) or 'training' (re-sent demonstration).
// summarize(json) gives the one-line description shown in the live call list.
export async function callTask({ task, userMessage, sessionId, kind = 'live', mockContext, summarize }) {
  const config = getConfig();
  const system = SYSTEM_PROMPTS[task];
  if (!system) throw new Error(`Unknown task ${task}`);
  const started = Date.now();
  let result;
  try {
    if (config.provider === 'mock') {
      result = { text: JSON.stringify(mockAnswer(task, mockContext)), inTokens: 0, outTokens: 0, requestId: null };
    } else if (config.provider === 'anthropic') {
      result = await callAnthropic(config, system, userMessage, sessionId);
    } else if (config.provider === 'openai') {
      result = await callOpenAI(config, system, userMessage, sessionId);
    } else {
      throw new Error(`Unknown MUBIT_PROVIDER "${config.provider}" (use anthropic or openai)`);
    }
  } catch (err) {
    logCall({ task, kind, ms: Date.now() - started, ok: false, model: config.model, provider: config.provider, sessionId, error: err.message, requestId: err.requestId });
    throw err;
  }
  const ms = Date.now() - started;
  const json = parseJson(result.text);
  logCall({
    task, kind, ms, ok: !!json, model: config.model, provider: config.provider, sessionId,
    inTokens: result.inTokens, outTokens: result.outTokens, requestId: result.requestId,
    summary: json ? safeSummary(summarize, json) : 'reply was not JSON',
  });
  if (!json) throw new LlmError(`Model reply was not JSON: ${result.text.slice(0, 200)}`, { requestId: result.requestId, code: 'bad_reply' });
  const usage = config.provider === 'mock'
    ? { inTokens: 0, outTokens: 0, costUsd: 0, adapterCostUsd: 0, adapterMs: null, viaMubit: false }
    : { inTokens: result.inTokens, outTokens: result.outTokens, ...costOf(result.inTokens, result.outTokens, config.model), viaMubit: true };
  return { json, ms, requestId: result.requestId, raw: result.text, usage };
}

function safeSummary(summarize, json) {
  try { return summarize ? summarize(json) : (json.action || (json.done !== undefined ? `done: ${json.done}` : '')); } catch { return ''; }
}

async function post(url, headers, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'timed out after 60 s' : (err.cause?.code || err.message);
    throw new LlmError(`Could not reach Mubit at ${new URL(url).origin}: ${why}`);
  }
  const requestId = res.headers.get('x-middleware-request-id');
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) {
    const err = data?.error || {};
    const message = err.message || data?.message || text.slice(0, 300) || res.statusText;
    throw new LlmError(`Mubit/provider error ${res.status}: ${message}`, { status: res.status, code: err.code || err.type, requestId });
  }
  if (!data) throw new LlmError(`Mubit/provider sent a reply that is not JSON: ${text.slice(0, 200)}`, { requestId });
  return { data, requestId };
}

// Claude 4.5-era models take temperature 0 and answer directly. Newer ones (Haiku 5.5,
// Sonnet 5.5, Opus 5.5…) reject a non-default temperature and think by default: keep the
// thinking short with low effort, and leave room for it before the JSON answer.
export function anthropicBody(model, system, userMessage, sessionId) {
  const legacy = /^claude-(3|haiku-4-5|sonnet-4-5|opus-4-[015])/.test(model);
  return {
    model,
    max_tokens: legacy ? 600 : 4000,
    ...(legacy ? { temperature: 0 } : { output_config: { effort: 'low' } }),
    system,
    messages: [{ role: 'user', content: userMessage }],
    // Anthropic takes only metadata.user_id; Mubit uses it as the session.
    metadata: { user_id: sessionId },
  };
}

async function callAnthropic(config, system, userMessage, sessionId) {
  const { data, requestId } = await post(`${config.baseUrl}/anthropic/v1/messages`, {
    'x-api-key': config.key,
    'anthropic-version': '2023-06-01',
  }, anthropicBody(config.model, system, userMessage, sessionId));
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return { text, inTokens: data.usage?.input_tokens || 0, outTokens: data.usage?.output_tokens || 0, requestId };
}

async function callOpenAI(config, system, userMessage, sessionId) {
  const { data, requestId } = await post(`${config.baseUrl}/openai/v1/chat/completions`, {
    authorization: `Bearer ${config.key}`,
  }, {
    model: config.model,
    max_completion_tokens: 600,
    messages: [{ role: 'system', content: system }, { role: 'user', content: userMessage }],
    metadata: { session_id: sessionId },
  });
  const text = data.choices?.[0]?.message?.content || '';
  return { text, inTokens: data.usage?.prompt_tokens || 0, outTokens: data.usage?.completion_tokens || 0, requestId };
}

const ANSWER_KEYS = ['action', 'done', 'allow'];

export function parseJson(text) {
  if (!text) return null;
  // The model sometimes wraps its JSON in prose or a made-up tool call, or answers,
  // "reconsiders" and answers again: take the last JSON object that is an answer.
  const objects = jsonObjects(text.replace(/```(?:json)?/g, ''));
  const answers = objects.filter(o => ANSWER_KEYS.some(k => k in o));
  if (answers.length) return answers[answers.length - 1];
  if (objects.length) return objects[objects.length - 1];
  // No JSON at all: read a tool-call style reply,
  // <invoke name="click"><parameter name="element_id">e28</parameter>…</invoke>
  const invoke = [...text.matchAll(/<invoke name="([^"]+)">([\s\S]*?)(?=<invoke|<\/invoke>|$)/g)].pop();
  if (!invoke) return null;
  const out = { action: invoke[1] };
  for (const [, key, value] of invoke[2].matchAll(/<parameter name="([^"]+)">([\s\S]*?)<\/parameter>/g)) {
    out[key] = value === 'true' ? true : value === 'false' ? false : value.trim();
  }
  return out;
}

function jsonObjects(text) {
  const found = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = depth > 0;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && depth > 0 && --depth === 0) {
      try { found.push(JSON.parse(text.slice(start, i + 1))); } catch { /* not JSON after all */ }
    }
  }
  return found;
}
