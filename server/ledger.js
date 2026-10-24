// Local record of every model call, used for the ledger screen.
// Mubit's console is the source of truth for kept examples and adapter versions;
// this file only shows what we sent and what it cost us.

import fs from 'node:fs';
import path from 'node:path';

const KEPT_EXAMPLES_TO_TRAIN = 25;

function dataDir() {
  const dir = process.env.SHOWME_DATA_DIR || path.resolve(import.meta.dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const callsFile = () => path.join(dataDir(), 'calls.jsonl');
const runsFile = () => path.join(dataDir(), 'runs.jsonl');
const settingsFile = () => path.join(dataDir(), 'settings.json');

// Live listeners (the side panel's event stream) hear every call as it is logged.
const listeners = new Set();
export function onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(type, data) { for (const fn of listeners) { try { fn(type, data); } catch { /* a closed stream */ } } }

export function logCall(entry) {
  const record = { ts: new Date().toISOString(), ...entry };
  if (record.ok && record.provider !== 'mock') Object.assign(record, costOf(record.inTokens, record.outTokens));
  fs.appendFileSync(callsFile(), JSON.stringify(record) + '\n');
  emit('call', record);
  return record;
}

export function recentCalls(limit = 50) {
  return readCalls().slice(-limit).reverse();
}

// One line per finished agent run, for "failures → improvements".
export function addRun(run) {
  const record = { ts: new Date().toISOString(), ...run };
  fs.appendFileSync(runsFile(), JSON.stringify(record) + '\n');
  emit('run', record);
  return record;
}

export function readRuns() {
  if (!fs.existsSync(runsFile())) return [];
  return fs.readFileSync(runsFile(), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Real adapter numbers typed in from Mubit's Try models replace the estimates.
export function getSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}

export function saveSettings(update) {
  const next = { ...getSettings() };
  for (const key of ['adapterCostRatio', 'adapterLatencyMs']) {
    if (update[key] === null) delete next[key];
    else if (update[key] !== undefined) {
      const n = Number(update[key]);
      if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error(`${key} must be a positive number`), { status: 400 });
      next[key] = n;
    }
  }
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  emit('settings', next);
  return next;
}

export function readCalls() {
  if (!fs.existsSync(callsFile())) return [];
  return fs.readFileSync(callsFile(), 'utf8').split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

export function clearCalls() {
  for (const file of [callsFile(), runsFile()]) if (fs.existsSync(file)) fs.rmSync(file);
}

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Prices in USD per million tokens. Override with PRICE_IN_PER_M / PRICE_OUT_PER_M.
function prices() {
  const settings = getSettings();
  return {
    in: Number(process.env.PRICE_IN_PER_M || 1),
    out: Number(process.env.PRICE_OUT_PER_M || 5),
    // Adapter numbers are estimates until real ones from Try models are saved in settings.
    adapterCostRatio: settings.adapterCostRatio ?? Number(process.env.ADAPTER_COST_RATIO || 0.05),
    adapterLatencyMs: settings.adapterLatencyMs ?? Number(process.env.ADAPTER_LATENCY_MS || 200),
    measured: settings.adapterCostRatio !== undefined || settings.adapterLatencyMs !== undefined,
  };
}

// Cost of one call on the provider, and the estimated cost of the same call on a Mubit adapter.
export function costOf(inTokens = 0, outTokens = 0) {
  const p = prices();
  const costUsd = (inTokens * p.in + outTokens * p.out) / 1e6;
  return { costUsd, adapterCostUsd: costUsd * p.adapterCostRatio, adapterMs: p.adapterLatencyMs };
}

export function ledgerStats({ provider, model }) {
  const calls = readCalls();
  const p = prices();
  const byTask = {};
  for (const c of calls) {
    const t = (byTask[c.task] ||= { task: c.task, calls: 0, live: 0, training: 0, trainingViaMubit: 0, errors: 0, ms: [], inTokens: 0, outTokens: 0, real: 0 });
    t.calls++;
    if (c.kind === 'training') t.training++; else t.live++;
    if (!c.ok) { t.errors++; continue; }
    if (c.provider !== 'mock') {
      t.real++;
      if (c.kind === 'training') t.trainingViaMubit++;
      t.model = c.model;
      t.ms.push(c.ms);
      t.inTokens += c.inTokens || 0;
      t.outTokens += c.outTokens || 0;
    }
  }
  const tasks = Object.values(byTask).map(t => {
    const costPerCall = t.real ? ((t.inTokens / t.real) * p.in + (t.outTokens / t.real) * p.out) / 1e6 : null;
    const providerPer1k = costPerCall === null ? null : costPerCall * 1000;
    return {
      task: t.task,
      model: t.model || null,
      calls: t.calls,
      live: t.live,
      training: t.training,
      trainingViaMubit: t.trainingViaMubit,
      errors: t.errors,
      sentToMubit: t.real,
      towardsFirstTraining: Math.min(t.real, KEPT_EXAMPLES_TO_TRAIN),
      keptExamplesNeeded: KEPT_EXAMPLES_TO_TRAIN,
      p50Ms: median(t.ms),
      avgInTokens: t.real ? Math.round(t.inTokens / t.real) : null,
      avgOutTokens: t.real ? Math.round(t.outTokens / t.real) : null,
      providerCostPer1k: providerPer1k,
      adapterCostPer1kEstimate: providerPer1k === null ? null : providerPer1k * p.adapterCostRatio,
      adapterP50MsEstimate: p.adapterLatencyMs,
      monthlyAt50kPerDay: providerPer1k === null ? null : {
        provider: providerPer1k * 50 * 30,
        adapterEstimate: providerPer1k * 50 * 30 * p.adapterCostRatio,
      },
    };
  }).sort((a, b) => a.task.localeCompare(b.task));
  const real = calls.filter(c => c.ok && c.provider !== 'mock');
  const spent = real.reduce((sum, c) => sum + costOf(c.inTokens, c.outTokens).costUsd, 0);
  const totals = {
    callsViaMubit: real.length,
    providerUsd: spent,
    adapterUsdEstimate: spent * p.adapterCostRatio,
    savedUsdEstimate: spent * (1 - p.adapterCostRatio),
    p50Ms: median(real.map(c => c.ms)),
    adapterMsEstimate: p.adapterLatencyMs,
    adapterMeasured: p.measured,
    adapterCostRatio: p.adapterCostRatio,
  };
  return { provider, model, keptExamplesToTrain: KEPT_EXAMPLES_TO_TRAIN, tasks, totals, totalCalls: calls.length };
}
