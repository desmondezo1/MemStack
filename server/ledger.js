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

export function logCall(entry) {
  fs.appendFileSync(callsFile(), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

export function readCalls() {
  if (!fs.existsSync(callsFile())) return [];
  return fs.readFileSync(callsFile(), 'utf8').split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

export function clearCalls() {
  if (fs.existsSync(callsFile())) fs.rmSync(callsFile());
}

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Prices in USD per million tokens. Override with PRICE_IN_PER_M / PRICE_OUT_PER_M.
function prices() {
  return {
    in: Number(process.env.PRICE_IN_PER_M || 1),
    out: Number(process.env.PRICE_OUT_PER_M || 5),
    // Adapter numbers are estimates until we read real ones from Try models.
    adapterCostRatio: Number(process.env.ADAPTER_COST_RATIO || 0.05),
    adapterLatencyMs: Number(process.env.ADAPTER_LATENCY_MS || 200),
  };
}

export function ledgerStats({ provider, model }) {
  const calls = readCalls();
  const p = prices();
  const byTask = {};
  for (const c of calls) {
    const t = (byTask[c.task] ||= { task: c.task, calls: 0, live: 0, training: 0, errors: 0, ms: [], inTokens: 0, outTokens: 0, real: 0 });
    t.calls++;
    if (c.kind === 'training') t.training++; else t.live++;
    if (!c.ok) { t.errors++; continue; }
    if (c.provider !== 'mock') {
      t.real++;
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
  return { provider, model, keptExamplesToTrain: KEPT_EXAMPLES_TO_TRAIN, tasks, totalCalls: calls.length };
}
