// Every model call goes through here. With a Mubit key, calls go to the provider
// through Mubit's gateway, so Mubit records them and trains adapters per task.
// Without a key, a deterministic mock answers so the whole flow can be tested offline.

import { SYSTEM_PROMPTS } from './prompts.js';
import { mockAnswer } from './mock.js';
import { logCall } from './ledger.js';

export function getConfig() {
  const key = process.env.MUBIT_API_KEY || '';
  let provider = (process.env.MUBIT_PROVIDER || 'anthropic').toLowerCase();
  if (!key || process.env.SHOWME_MOCK === '1') provider = 'mock';
  const defaults = { anthropic: 'claude-haiku-4-5', openai: 'gpt-6-luna', mock: 'mock-agent' };
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
export async function callTask({ task, userMessage, sessionId, kind = 'live', mockContext }) {
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
  });
  if (!json) throw new LlmError(`Model reply was not JSON: ${result.text.slice(0, 200)}`, { requestId: result.requestId });
  return { json, ms, requestId: result.requestId, raw: result.text };
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

async function callAnthropic(config, system, userMessage, sessionId) {
  const { data, requestId } = await post(`${config.baseUrl}/anthropic/v1/messages`, {
    'x-api-key': config.key,
    'anthropic-version': '2023-06-01',
  }, {
    model: config.model,
    max_tokens: 300,
    temperature: 0,
    system,
    messages: [{ role: 'user', content: userMessage }],
    // Anthropic takes only metadata.user_id; Mubit uses it as the session.
    metadata: { user_id: sessionId },
  });
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return { text, inTokens: data.usage?.input_tokens || 0, outTokens: data.usage?.output_tokens || 0, requestId };
}

async function callOpenAI(config, system, userMessage, sessionId) {
  const { data, requestId } = await post(`${config.baseUrl}/openai/v1/chat/completions`, {
    authorization: `Bearer ${config.key}`,
  }, {
    model: config.model,
    max_completion_tokens: 400,
    messages: [{ role: 'system', content: system }, { role: 'user', content: userMessage }],
    metadata: { session_id: sessionId },
  });
  const text = data.choices?.[0]?.message?.content || '';
  return { text, inTokens: data.usage?.prompt_tokens || 0, outTokens: data.usage?.completion_tokens || 0, requestId };
}

export function parseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}
