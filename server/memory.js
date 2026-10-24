// MemStack's short-term memory: human demonstrations, recalled into the user
// message of later runs on the same page. This is the part that makes the live
// rerun succeed; Mubit's adapter is the long-term learning.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function demosFile() {
  const dir = process.env.SHOWME_DATA_DIR || path.resolve(import.meta.dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'demos.json');
}

export function pageKey(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

export function listDemos() {
  const file = demosFile();
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function saveDemos(demos) {
  fs.writeFileSync(demosFile(), JSON.stringify(demos, null, 2));
}

export function addDemo({ goal, url, steps, mistake, answers = [] }) {
  // Steps are stored by element label, not id: ids change between page loads.
  // Each step keeps the page it happened on, so a lesson spanning several pages
  // is recalled on every one of them.
  const stored = steps.map(s => ({
    action: s.action, label: s.label, role: s.role, value: s.value ?? '', submit: s.submit === true,
    page: pageKey(s.page?.url || url),
  }));
  const demo = {
    id: crypto.randomUUID().slice(0, 8),
    goal,
    page: pageKey(url),
    pages: [...new Set([pageKey(url), ...stored.map(s => s.page), ...answers.map(a => pageKey(a.page?.url || url))])],
    steps: stored,
    mistake: mistake ? String(mistake).slice(0, 300) : null,
    // Text the human pointed out as the answer, recalled by the locate task.
    answers: answers.map(a => ({ value: String(a.value || '').slice(0, 200), page: pageKey(a.page?.url || url) })),
    createdAt: new Date().toISOString(),
  };
  const demos = listDemos();
  demos.push(demo);
  saveDemos(demos);
  return demo;
}

export function updateDemo(id, fields) {
  const demos = listDemos();
  const demo = demos.find(d => d.id === id);
  if (!demo) return null;
  Object.assign(demo, fields);
  saveDemos(demos);
  return demo;
}

export function clearDemos() {
  saveDemos([]);
}

const STOP = new Set(['a', 'an', 'the', 'at', 'for', 'to', 'on', 'in', 'of', 'me', 'my', 'please', 'and']);
const tokens = s => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w)));

// Best demonstration for this page and goal: a lesson that touched this page and
// shares at least one goal word (an unrelated lesson would mislead the model and
// become a bad training example). Newer lessons win ties, so re-teaching replaces
// an old one.
export function recallDemo({ url, goal }) {
  const key = pageKey(url);
  const goalTokens = tokens(goal);
  let best = null;
  let bestScore = 0;
  for (const demo of listDemos()) {
    if (!(demo.pages || [demo.page]).includes(key)) continue;
    let score = 0;
    for (const t of tokens(demo.goal)) if (goalTokens.has(t)) score++;
    if (score > 0 && score >= bestScore) { best = demo; bestScore = score; }
  }
  return best;
}
