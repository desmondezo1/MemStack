// Run the Sapling verifier on a saved page:  node verify-demo.js fixtures/payment-page.txt
// A fixture may start with "goal: …" and a "---" line; the rest is the page's visible text.
// Prints the done-check and the safety-gate verdicts. Every call is logged to verifier.log.

import fs from 'node:fs';
import { verifyDone, verifySafe } from './server/verifier.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node verify-demo.js <page.txt>');
  process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8');
const [head, body] = raw.includes('\n---\n') ? raw.split('\n---\n') : ['', raw];
const goal = head.match(/^goal:\s*(.+)$/m)?.[1] || 'Book a table for two tonight at eight. Never pay or submit payment details.';
const constraints = goal.match(/Never [^.]+\./)?.[0];

const pct = n => (n == null ? '  —  ' : `${(n * 100).toFixed(1).padStart(5)}%`);
const show = (title, r, extra = '') => {
  console.log(`\n${title}: ${r.verdict.toUpperCase()}${extra}${r.error ? ` (${r.error})` : ` · Sapling label ${r.label}`}`);
  for (const [label, p] of Object.entries(r.scores)) console.log(`  ${label.padEnd(26)} ${pct(p)}`);
};

console.log(`${file}\nGoal: ${goal}`);
const [done, safe] = await Promise.all([
  verifyDone({ goal, pageText: body }),
  verifySafe({ goal, constraints, evidence: body }),
]);
show('Done-check', done, done.verdict === 'fail' ? ' → would trigger "Show me"' : '');
show('Safety gate', safe, safe.block ? ` → click BLOCKED (safe score ${pct(safe.safeScore).trim()})` : ` → click allowed (safe score ${pct(safe.safeScore).trim()})`);
