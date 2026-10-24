// Offline stand-in for the model, used when no MUBIT_API_KEY is set.
// It is a naive rule-based agent: good enough to drive the demo site, and it
// guesses the sitting the way a model with no extra knowledge would — badly —
// until a human demonstration is recalled. Not a real model; never pitch it as one.

import { TASKS } from './prompts.js';

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

export function partySize(goal) {
  const g = goal.toLowerCase();
  const m = g.match(/(?:for|party of|table for)\s+(\d+|[a-z]+)/);
  if (!m) return null;
  const n = Number(m[1]) || NUMBER_WORDS[m[1]];
  return n || null;
}

// "at eight", "at 8pm", "at 20:00", "at half past six", "at quarter past nine" -> "HH:MM" (evening assumed)
export function goalTime(goal) {
  const g = goal.toLowerCase();
  const m = g.match(/\bat\s+(quarter past |half past |quarter to )?(\d{1,2}|[a-z]+)(?::(\d{2}))?\s*(pm|am)?/);
  if (!m) return null;
  let hour = Number(m[2]) || NUMBER_WORDS[m[2]];
  if (!hour) return null;
  let minute = m[3] ? Number(m[3]) : 0;
  if (m[1] === 'quarter past ') minute = 15;
  if (m[1] === 'half past ') minute = 30;
  if (m[1] === 'quarter to ') { minute = 45; hour -= 1; }
  if (m[4] !== 'am' && hour < 12) hour += 12;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function guestName(goal) {
  const m = goal.match(/(?:under|in) the name (?:of )?([A-Za-z][A-Za-z' -]{0,30})/i) || goal.match(/\bname (?:is )?([A-Z][A-Za-z' -]{0,30})/);
  return m ? m[1].trim() : null;
}

const sameLabel = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const done = (history, label, action) => history.some(h => sameLabel(h.label, label) && (!action || h.action === action));

function nextAction({ goal, page, history = [], demo }) {
  const els = page.elements || [];
  const act = (el, action, value = '', reason = '') => ({ action, element_id: el.id, value: String(value), reason });

  // Go to the site the goal names first: a full URL, or "open <site>" from a blank page.
  if (!history.some(h => h.action === 'open_url')) {
    const url = goal.match(/https?:\/\/[^\s,]+/)?.[0];
    if (url && !page.url.startsWith(url)) return { action: 'open_url', element_id: '', value: url, reason: 'Go to the requested site' };
    const site = goal.match(/\bopen (?:up )?([a-z0-9-]+)(?:\.com)?\b/i)?.[1];
    if (!url && site && !els.length) return { action: 'open_url', element_id: '', value: `https://www.${site.toLowerCase()}.com`, reason: 'Go to the requested site' };
    const taughtUrl = demo?.steps.find(s => s.action === 'open_url');
    if (taughtUrl) return { action: 'open_url', element_id: '', value: taughtUrl.value, reason: 'Following the human demonstration' };
  }
  if (!els.length) {
    // An empty page after some work is usually a confirmation page; before any work it's a dead end.
    return history.length
      ? { action: 'done', element_id: '', value: '', reason: 'Nothing left to do' }
      : { action: 'ask_human', element_id: '', value: 'I can\'t see anything to use on this page', reason: 'Nothing to act on' };
  }

  const dismiss = els.find(e => e.inDialog && /no thanks|not now|dismiss|close|reject/i.test(e.label));
  if (dismiss && !done(history, dismiss.label)) return act(dismiss, 'click', '', 'Dismiss the popup');

  const size = partySize(goal);

  if (demo) {
    for (const step of demo.steps) {
      if (step.action === 'open_url') continue; // handled above
      if (done(history, step.label, step.action)) continue;
      const el = els.find(e => sameLabel(e.label, step.label));
      if (!el) continue;
      let value = step.value;
      if (step.action === 'select' && /party|guest|people|size/i.test(step.label) && size) value = String(size);
      if (step.action === 'type' && /name/i.test(step.label)) value = guestName(goal) || step.value;
      return { ...act(el, step.action, value, 'Following the human demonstration'), submit: !!step.submit };
    }
    return { action: 'done', element_id: '', value: '', reason: 'Demonstration completed' };
  }

  // Cancelling a membership without a lesson: a naive agent takes the big
  // "recommended" button, which only pauses it. (A lesson, above, wins.)
  if (/\bcancel\b/i.test(goal)) {
    if (history.some(h => /pause/i.test(h.label || ''))) return { action: 'done', element_id: '', value: '', reason: 'Took the recommended option' };
    const pause = els.find(e => e.role === 'button' && /pause/i.test(e.label));
    if (pause) return act(pause, 'click', '', 'The recommended option');
  }

  // Video sites: search for the query, open the first matching result, press play.
  const query = videoQuery(goal);
  if (query) {
    const words = query.toLowerCase().split(/\s+/);
    const play = els.find(e => e.role === 'button' && /^\W*play\b/i.test(e.label));
    if (play && !done(history, play.label)) return act(play, 'click', '', 'Start the video');
    const result = els.find(e => e.role === 'link' && words.every(w => e.label.toLowerCase().includes(w)));
    if (result && !history.some(h => h.role === 'link')) return act(result, 'click', '', 'Open the best match');
    const search = els.find(e => (e.role === 'textbox' || e.role === 'combobox') && /search/i.test(e.label));
    if (search && !history.some(h => h.action === 'type')) return { ...act(search, 'type', query, 'Search for it'), submit: true };
  }

  const party = els.find(e => e.role === 'select' && /party|guest|people|size/i.test(e.label));
  if (party && size && String(party.value) !== String(size) && !done(history, party.label)) {
    return act(party, 'select', size, 'Set the party size');
  }

  const sittings = els.filter(e => e.role === 'radio' && /sitting|time|slot/i.test(`${e.group} ${e.label}`));
  if (sittings.length && !sittings.some(s => done(history, s.label))) {
    const time = goalTime(goal);
    const match = time && sittings.find(s => s.label.includes(time));
    // No visible time on the options: guess the first one, as a naive agent would.
    return act(match || sittings[0], 'click', '', match ? 'Matches the requested time' : 'Best guess for the time');
  }

  const name = els.find(e => e.role === 'textbox' && /name/i.test(e.label));
  if (name && !name.value && !done(history, name.label)) return act(name, 'type', guestName(goal) || 'Alex Guest', 'Fill in the name');

  const SUBMIT = /reserve|book|submit|confirm/i;
  if (history.some(h => h.action === 'click' && SUBMIT.test(h.label || ''))) {
    return { action: 'done', element_id: '', value: '', reason: 'Submitted the booking' };
  }
  const submit = els.find(e => e.role === 'button' && SUBMIT.test(e.label));
  if (submit) return act(submit, 'click', '', 'Submit the booking');

  return { action: 'done', element_id: '', value: '', reason: 'Nothing left to do' };
}

// "open YouTube and play a Burna Boy video" -> "Burna Boy"
export function videoQuery(goal) {
  const m = goal.match(/\b(?:play|watch|search for|find)\s+(?:a |an |the |some )?(.+?)(?:\s+(?:music )?videos?)?(?:\s+on\s+\S+)?\s*$/i);
  return m ? m[1].trim() : null;
}

function doneCheck({ goal, page }) {
  const text = page.text || '';
  if (/\bcancel\b/i.test(goal) && /membership|subscription/i.test(goal)) {
    if (!/membership cancelled/i.test(text)) return { done: false, problem: 'no_confirmation', reason: 'The membership is not cancelled' };
    if (/keep being charged/i.test(text)) return { done: false, problem: 'wrong_item', reason: 'Cancelled, but an add-on is still charging you' };
    return { done: true, problem: 'none', reason: 'Membership cancelled, no more charges' };
  }
  const q = videoQuery(goal);
  if (q) {
    if (!/now playing/i.test(text)) return { done: false, reason: 'No video is playing' };
    const ok = q.toLowerCase().split(/\s+/).every(w => text.toLowerCase().includes(w));
    return { done: ok, reason: ok ? 'The requested video is playing' : 'A different video is playing' };
  }
  if (!/confirmed|booked|see you/i.test(text)) return { done: false, reason: 'No confirmation on the page' };
  const time = goalTime(goal);
  if (time && !text.includes(time)) return { done: false, reason: `Booked, but not at ${time}` };
  const size = partySize(goal);
  if (size && !new RegExp(`\\b${size} guests?\\b`).test(text)) return { done: false, reason: `Booked, but not for ${size}` };
  return { done: true, reason: 'Confirmation matches the goal' };
}

function safetyGate({ goal, element }) {
  const risky = /pay|purchase|buy|delete|remove|transfer|send/i;
  if (risky.test(element?.label || '') && !risky.test(goal)) return { allow: false, reason: 'Irreversible action not in the goal' };
  return { allow: true, reason: 'Safe for this goal' };
}

// Answer a question from the page: the block sharing the most words with the question
// (or holding the text a human pointed out).
const WORDS_TO_SKIP = new Set(['what', 'when', 'where', 'which', 'does', 'this', 'that', 'with', 'have', 'there', 'their', 'your', 'show', 'page', 'they', 'from', 'about', 'tell']);
const words = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !WORDS_TO_SKIP.has(w));
function locate({ goal, page, hint }) {
  const blocks = page.blocks || [];
  if (hint) {
    const b = blocks.find(x => x.text.toLowerCase().includes(hint.toLowerCase().slice(0, 40)));
    if (b) return { found: true, block_id: b.id, answer: b.text };
  }
  const want = new Set(words(goal));
  let best = null;
  let bestScore = 0;
  for (const b of blocks) {
    if (/^h\d$/.test(b.tag)) continue; // a heading names a section; it isn't the answer
    const matches = words(b.text).filter(w => want.has(w)).length;
    if (!matches) continue;
    // Ties go to the fuller block: an answer, not a label for it.
    const score = matches + (b.tag.startsWith('h') ? -0.5 : 0) + Math.min(b.text.length, 200) / 1000;
    if (score > bestScore) { best = b; bestScore = score; }
  }
  return best && bestScore >= 0.5 ? { found: true, block_id: best.id, answer: best.text } : { found: false, block_id: '', answer: '' };
}

export function mockAnswer(task, context) {
  if (task === TASKS.nextAction) return nextAction(context);
  if (task === TASKS.doneCheck) return doneCheck(context);
  if (task === TASKS.safetyGate) return safetyGate(context);
  if (task === TASKS.locate) return locate(context);
  // Link check: what a reviewer said wins; otherwise the rule-based score decides.
  if (task === TASKS.linkCheck) {
    const s = context.signals;
    const verdict = context.reviewed || (s.score >= 70 ? 'phishing' : s.score >= 35 ? 'suspicious' : 'safe');
    return { verdict, pretends_to_be: verdict === 'safe' ? '' : (s.pretendsTo || '') };
  }
  // The mock agrees with the rule-based detour finder.
  if (task === TASKS.refineLesson) return { drop: [...context.detours.drop].map(i => i + 1), why: Object.fromEntries(Object.entries(context.detours.why).map(([i, w]) => [Number(i) + 1, w])) };
  throw new Error(`mock: unknown task ${task}`);
}
