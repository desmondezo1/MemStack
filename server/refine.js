// Cleaning up a human demonstration before it trains anything. People wander: they open
// the first search result, see it's wrong, go back and pick the next one. Only the path
// that worked should become training data. These rules catch the clear-cut cases; the
// refine-lesson model task (prompts.js) catches the rest, and the human has the last word.

const pageKey = url => { try { const u = new URL(url); return u.origin + u.pathname + u.search; } catch { return url || ''; } };
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Returns { drop: Set of step indexes, why: { index: reason } }.
export function findDetours(steps) {
  const drop = new Set();
  const why = {};
  const mark = (i, reason) => { if (!drop.has(i)) { drop.add(i); why[i] = reason; } };

  steps.forEach((s, i) => {
    // Opening a tab is not something the agent does: it goes straight to the site.
    if (s.action === 'new_tab') mark(i, 'Opening a tab: the agent goes straight to the site');
  });

  // Back where you were: everything from the first visit to this page up to now was a detour.
  for (let j = 1; j < steps.length; j++) {
    const here = pageKey(steps[j].page?.url);
    if (!here) continue;
    const i = steps.findIndex((s, k) => k < j && !drop.has(k) && pageKey(s.page?.url) === here);
    if (i === -1) continue;
    const leftAndCameBack = steps.slice(i, j).some(s => s.led_to && pageKey(s.led_to) !== here);
    if (!leftAndCameBack) continue;
    for (let k = i; k < j; k++) {
      if (steps[k].action === 'highlight') continue;
      mark(k, k === i ? 'Detour: you came back to this page afterwards' : 'Part of a detour you came back from');
    }
  }

  // Typing or choosing in the same field again: only the last one counts.
  steps.forEach((s, i) => {
    if (drop.has(i) || !['type', 'select'].includes(s.action)) return;
    const later = steps.findIndex((t, k) => k > i && !drop.has(k) && t.action === s.action && same(t.label, s.label) && pageKey(t.page?.url) === pageKey(s.page?.url));
    if (later !== -1) mark(i, 'Changed again later');
  });

  // A checkbox ticked and unticked cancels out.
  steps.forEach((s, i) => {
    if (drop.has(i) || s.action !== 'click' || s.role !== 'checkbox') return;
    const undo = steps.findIndex((t, k) => k > i && !drop.has(k) && t.action === 'click' && same(t.label, s.label) && pageKey(t.page?.url) === pageKey(s.page?.url));
    if (undo !== -1) { mark(i, 'Ticked, then unticked'); mark(undo, 'Ticked, then unticked'); }
  });

  return { drop, why };
}

// What the agent can replay: switching tabs becomes opening that page; tab opening goes.
export function forTraining(steps) {
  return steps
    .filter(s => s.action !== 'new_tab')
    .map(s => (s.action === 'switch_tab' ? { ...s, action: 'open_url', value: s.value, label: '', role: '' } : s));
}
