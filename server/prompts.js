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
  // v2: full browser toolset. (v1 only had click/type/select/done; its Mubit task is separate.)
  [TASKS.nextAction]: [
    'You control a web browser for a user. You get the user\'s goal, the current page (URL and interactive elements), the steps already taken, and sometimes a demonstration a human recorded.',
    'Choose exactly one next action.',
    'Reply with JSON only, no prose: {"action":"<action>","element_id":"<id from the list, or empty>","value":"<see below, or empty>","submit":false,"reason":"<at most 12 words>"}',
    'Actions:',
    '- click: element_id.',
    '- type: element_id, value = the text. Set "submit":true to press Enter afterwards (search boxes).',
    '- select: element_id, value = the option text.',
    '- press: value = Enter, Escape, Tab, ArrowDown or ArrowUp; element_id optional (default: focused element).',
    '- open_url: value = a full https URL. Use it to go to a site, or straight to a search results URL when you know its pattern.',
    '- back: go back one page.',
    '- scroll: value = down or up, to reveal more of the page.',
    '- wait: the page is still loading.',
    '- ask_human: you are stuck or unsure; value = what you need. A human will show you how.',
    '- done: the goal is complete.',
    'Rules: use only element ids from the list. Do not repeat a step that already succeeded. If a demonstration covers this page, follow it, adapting values to the current goal. Prefer open_url over clicking through menus when you know the address. Reply "done" only when the page shows the goal is achieved or the last step completed it.',
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
  if (page.scroll) lines.push(`Scroll: ${page.scroll}`);
  // A little visible text tells the model what state the page is in ("Now playing", errors…).
  const text = (page.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (text) lines.push(`Text: ${text}`);
  lines.push('Elements:');
  const elements = (page.elements || []).slice(0, MAX_ELEMENTS);
  if (!elements.length) lines.push(page.note || 'none');
  for (const el of elements) lines.push(formatElement(el));
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
  const target = step.label ? `${step.role || 'element'} "${step.label}"` : (step.element_id || 'the page');
  switch (step.action) {
    case 'type': return `type "${step.value}" into ${target}${step.submit ? ' and press Enter' : ''}`;
    case 'select': return `select "${step.value}" in ${target}`;
    case 'press': return `press ${step.value}${step.label ? ` on ${target}` : ''}`;
    case 'open_url': return `open ${step.value}`;
    case 'back': return 'go back';
    case 'scroll': return `scroll ${step.value || 'down'}`;
    case 'wait': return 'wait for the page';
    case 'ask_human': return `ask the human: ${step.value}`;
    case 'done': return 'done';
    default: return `click ${target}`;
  }
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
  parts.push('', 'Answer with one JSON object only.');
  return parts.join('\n');
}

export function buildDoneCheckMessage({ goal, page }) {
  const text = (page.text || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  return `Goal: ${goal}\n\nURL: ${page.url}\nPage text: ${text}\n\nAnswer with one JSON object only.`;
}

export function buildSafetyMessage({ goal, action, element }) {
  return `Goal: ${goal}\n\nPending action: ${formatStep({ ...action, label: element?.label, role: element?.role })}`;
}
