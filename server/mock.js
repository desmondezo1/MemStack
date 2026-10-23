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

  const dismiss = els.find(e => e.inDialog && /no thanks|not now|dismiss|close|reject/i.test(e.label));
  if (dismiss && !done(history, dismiss.label)) return act(dismiss, 'click', '', 'Dismiss the popup');

  const size = partySize(goal);

  if (demo) {
    for (const step of demo.steps) {
      if (done(history, step.label, step.action)) continue;
      const el = els.find(e => sameLabel(e.label, step.label));
      if (!el) continue;
      let value = step.value;
      if (step.action === 'select' && /party|guest|people|size/i.test(step.label) && size) value = String(size);
      if (step.action === 'type' && /name/i.test(step.label)) value = guestName(goal) || step.value;
      return act(el, step.action, value, 'Following the human demonstration');
    }
    return { action: 'done', element_id: '', value: '', reason: 'Demonstration completed' };
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

function doneCheck({ goal, page }) {
  const text = page.text || '';
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

export function mockAnswer(task, context) {
  if (task === TASKS.nextAction) return nextAction(context);
  if (task === TASKS.doneCheck) return doneCheck(context);
  if (task === TASKS.safetyGate) return safetyGate(context);
  throw new Error(`mock: unknown task ${task}`);
}
