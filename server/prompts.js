// Fixed system prompts, one per Mubit task.
// Mubit groups calls into a task by model + system prompt + tools + output format.
// Changing any of these strings starts a NEW task and resets the example count,
// so everything that varies per call goes in the user message instead.

export const TASKS = {
  nextAction: 'next-action',
  doneCheck: 'done-check',
  safetyGate: 'safety-gate',
};

export const SYSTEM_PROMPTS = {
  [TASKS.nextAction]: [
    'You control a web browser for a user. You get the user\'s goal, the page\'s interactive elements, the steps already taken, and sometimes a demonstration a human recorded on this page.',
    'Choose exactly one next action.',
    'Reply with JSON only, no prose: {"action":"click"|"type"|"select"|"done","element_id":"<id from the list, or empty for done>","value":"<text to type or option to select, else empty>","reason":"<at most 12 words>"}',
    'Rules: use only element ids from the list. Do not repeat a step that already succeeded. If a demonstration covers this page, follow it, adapting values to the current goal. Reply "done" when the goal is complete or the last step submitted it.',
  ].join('\n'),

  [TASKS.doneCheck]: [
    'You check whether a browser task succeeded. You get the user\'s goal and the visible text of the page after the agent finished.',
    'Reply with JSON only, no prose: {"done":true|false,"reason":"<at most 15 words>"}',
    'Say done only if the page shows the goal was completed with every detail the user asked for (amounts, times, names).',
  ].join('\n'),

  [TASKS.safetyGate]: [
    'You protect a user from irreversible browser actions. You get the user\'s goal and the action the agent is about to take.',
    'Reply with JSON only, no prose: {"allow":true|false,"reason":"<at most 12 words>"}',
    'Block payments, purchases, deletions, sending messages or transfers unless the goal clearly asks for exactly that.',
  ].join('\n'),
};

// Same cap as the content script, so the model sees every element we validate against.
const MAX_ELEMENTS = 80;

// Turns a page snapshot from the content script into the short text block the
// model sees. Kept compact: Mubit fails training on examples that are too long.
export function formatPage(page) {
  const lines = [];
  lines.push(`URL: ${page.url}`);
  if (page.title) lines.push(`Title: ${page.title}`);
  if (page.headings?.length) lines.push(`Headings: ${page.headings.slice(0, 5).join(' | ')}`);
  lines.push('Elements:');
  for (const el of (page.elements || []).slice(0, MAX_ELEMENTS)) {
    lines.push(formatElement(el));
  }
  return lines.join('\n');
}

export function formatElement(el) {
  let line = `${el.id} ${el.role} "${el.label}"`;
  if (el.group) line += ` group="${el.group}"`;
  if (el.value !== undefined && el.value !== '') line += ` value="${el.value}"`;
  if (el.checked !== undefined) line += ` checked=${el.checked}`;
  if (el.options?.length) line += ` options=[${el.options.slice(0, 12).join(', ')}]`;
  if (el.disabled) line += ' disabled';
  if (el.inDialog) line += ' [in dialog]';
  return line;
}

export function formatStep(step) {
  const target = step.label ? `${step.role || 'element'} "${step.label}"` : step.element_id;
  if (step.action === 'type') return `type "${step.value}" into ${target}`;
  if (step.action === 'select') return `select "${step.value}" in ${target}`;
  if (step.action === 'done') return 'done';
  return `click ${target}`;
}

export function formatDemonstration(demo) {
  if (!demo) return '';
  const lines = [`Demonstration recorded by a human on this page for the goal "${demo.goal}":`];
  demo.steps.forEach((s, i) => lines.push(`${i + 1}. ${formatStep(s)}`));
  return lines.join('\n');
}

export function buildNextActionMessage({ goal, page, history = [], demo }) {
  const parts = [`Goal: ${goal}`, '', formatPage(page), ''];
  parts.push('Steps already taken:');
  if (Array.isArray(history) && history.length) history.slice(-8).forEach((s, i) => parts.push(`${i + 1}. ${formatStep(s)}`));
  else parts.push('none');
  if (demo) parts.push('', formatDemonstration(demo));
  return parts.join('\n');
}

export function buildDoneCheckMessage({ goal, page }) {
  const text = (page.text || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  return `Goal: ${goal}\n\nURL: ${page.url}\nPage text: ${text}`;
}

export function buildSafetyMessage({ goal, action, element }) {
  return `Goal: ${goal}\n\nPending action: ${formatStep({ ...action, label: element?.label, role: element?.role })}`;
}
