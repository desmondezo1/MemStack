// Banyan Sapling verifier: an independent second opinion that checks a claim against a
// policy and evidence. Used on the done-check and before risky clicks. Sapling is called
// directly (not through Mubit), and every call is appended to verifier.log.

import fs from 'node:fs';
import path from 'node:path';

const endpoint = () => process.env.SAPLING_URL || 'https://6adbee0669a00298cd4774c9.endpoints.huggingface.cloud';
const logFile = () => process.env.SAPLING_LOG || path.resolve(import.meta.dirname, '..', 'verifier.log');
const MAX_EVIDENCE = 4000;
// A click is blocked when Sapling puts at least this much probability on "violation".
const BLOCK_AT = Number(process.env.SAPLING_BLOCK_AT || 0.3);

export const DEFAULT_CONSTRAINTS = 'Never pay or submit payment details.';

// Off with SAPLING=off; off by default in practice mode (tests), on with SAPLING=on.
export const verifierEnabled = () => process.env.SAPLING === 'on' || (process.env.SAPLING !== 'off' && process.env.SHOWME_MOCK !== '1');

// Sapling labels → our verdict. "insufficient_information" is not a failure: the page
// may simply not say enough, so the caller keeps its own judgement.
const VERDICT = { supported: 'pass', violation: 'fail', inconsistent_context: 'fail', insufficient_information: 'unsure' };

export async function verify(claim, policy, evidence) {
  const inputs = { claim, policy, evidence: String(evidence || '').replace(/\s+/g, ' ').trim().slice(0, MAX_EVIDENCE) };
  const started = Date.now();
  let result;
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error || !data.probabilities) throw new Error(data.error || `HTTP ${res.status}`);
    result = { verdict: VERDICT[data.raw_label] || 'unsure', scores: data.probabilities, label: data.raw_label, status: data.status };
  } catch (err) {
    // Unreachable or malformed: report it, and let the caller fall back to its own check.
    result = { verdict: 'error', scores: {}, error: err.message };
  }
  log({ ts: new Date().toISOString(), ms: Date.now() - started, inputs, ...result });
  return result;
}

function log(entry) {
  try { fs.appendFileSync(logFile(), JSON.stringify(entry) + '\n'); } catch { /* logging never breaks the agent */ }
}

// Sapling can't know what "tonight" means without today's date, so policies carry it.
const today = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// After the final step: is the task really done, given the page? A clear violation
// signal fails it even when Sapling's top label is "insufficient_information".
export async function verifyDone({ goal, pageText }) {
  const result = await verify(`Task complete: ${goal}`, `Today is ${today()}. ${goal}`, pageText);
  if (result.verdict !== 'error' && (result.scores.violation ?? 0) >= BLOCK_AT) result.verdict = 'fail';
  return result;
}

// Before a submit/pay/delete click: is it safe under the user's constraints?
export async function verifySafe({ goal, constraints, evidence }) {
  const policy = `Today is ${today()}. ${constraints || DEFAULT_CONSTRAINTS} The user asked: ${goal}`;
  const result = await verify('This action is safe under the policy', policy, evidence);
  const violation = result.scores.violation ?? 0;
  return { ...result, safeScore: 1 - violation, block: result.verdict !== 'error' && violation >= BLOCK_AT };
}
