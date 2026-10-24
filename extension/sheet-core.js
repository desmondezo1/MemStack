// Sheet to form: read rows, work out from one taught row where each form value comes from,
// and give the values for every other row. Pure functions (no chrome.*), so the panel uses
// them and the unit tests can too.

// CSV text → { columns, rows }. Handles quotes, escaped quotes and newlines inside quotes.
export function parseCsv(text) {
  const out = [];
  let row = [], cell = '', quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return toTable(out);
}

// Rows of cells (first row = headers) → { columns, rows: [{ column: value }] }. Columns with
// no header (a row-number column) and empty rows are dropped.
export function toTable(grid) {
  const lines = grid.map(r => r.map(c => String(c ?? '').trim())).filter(r => r.some(Boolean));
  if (!lines.length) return { columns: [], rows: [] };
  const header = lines[0];
  const keep = header.map((h, i) => (h ? i : -1)).filter(i => i >= 0);
  const columns = keep.map(i => header[i]);
  const rows = lines.slice(1).map(r => Object.fromEntries(keep.map(i => [header[i], r[i] ?? ''])))
    .filter(r => Object.values(r).some(Boolean));
  return { columns, rows };
}

const norm = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// The closest option in a dropdown: exact, then one that starts with the other ("Eng" →
// "Engineering"). Null if nothing is close: then Claude decides.
export function closestOption(value, options = []) {
  const v = norm(value);
  if (!v) return null;
  return options.find(o => norm(o) === v)
    || options.find(o => norm(o).startsWith(v) || v.startsWith(norm(o)))
    || null;
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const dateFormat = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim()) ? 'YYYY-MM-DD' : String(value).includes('/') && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(value).trim()) ? 'DD/MM/YYYY' : 'DD/MM/YYYY');

// A note that asks for a value Mo can compute: "a random weekday in the next two weeks",
// "today", "tomorrow". Models are bad at being random, so code makes these values.
export function generatedFromNote(note, example) {
  const n = norm(note);
  const format = dateFormat(example);
  const span = n.match(/next\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week|month)s?/);
  if (/random/.test(n) && /(date|day|weekday)/.test(n)) {
    const count = span ? (Number(span[1]) || NUMBER_WORDS[span[1]]) : 2;
    const unit = span ? span[2] : 'week';
    const days = count * (unit === 'week' ? 7 : unit === 'month' ? 30 : 1);
    return { kind: /weekday|working day|business day/.test(n) ? 'random-weekday' : 'random-date', days, format };
  }
  if (/\btomorrow\b/.test(n)) return { kind: 'tomorrow', days: 1, format };
  if (/\btoday\b/.test(n)) return { kind: 'today', days: 0, format };
  return null;
}

// Work out a rule for every value the human filled in on the form, from the one row they did.
//   column:    the value matches a cell in that row → take that column for every row
//   generated: a note asks for a value code can make (random weekday, today)
//   ask:       a note says to ask
//   note:      any other note: Claude reads it and decides (with the taught value as an example)
//   fixed:     same value every time
// steps: the recorded lesson. row: the sheet row that was taught. columns: the sheet's columns.
export function inferRules(steps, row, columns) {
  const fills = steps.filter(s => (s.action === 'type' || s.action === 'select') && s.label);
  return fills.map(s => {
    const base = { label: s.label, role: s.role, action: s.action, value: String(s.value ?? ''), note: s.note || '', options: s.page?.elements?.find(e => e.label === s.label)?.options || [] };
    const column = columns.find(c => norm(row[c]) && norm(row[c]) === norm(s.value))
      || (s.action === 'select' ? columns.find(c => norm(row[c]) && closestOption(row[c], [s.value])) : null);
    if (column) return { ...base, type: 'column', column };
    if (s.note && /\bask me\b/i.test(s.note)) return { ...base, type: 'ask' };
    const gen = s.note ? generatedFromNote(s.note, s.value) : null;
    if (gen) return { ...base, type: 'generated', ...gen };
    if (s.note) return { ...base, type: 'note' };
    return { ...base, type: 'fixed' };
  });
}

const pad = n => String(n).padStart(2, '0');
const formatDate = (d, format) => (format === 'YYYY-MM-DD' ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`);

export function generateValue(rule, { today = new Date(), random = Math.random } = {}) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (rule.kind === 'today') return formatDate(start, rule.format);
  if (rule.kind === 'tomorrow') return formatDate(new Date(start.getTime() + 86400000), rule.format);
  // Random day from tomorrow to `days` ahead; weekdays only when asked.
  const choices = [];
  for (let i = 1; i <= Math.max(1, rule.days || 14); i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (rule.kind !== 'random-weekday' || (d.getDay() !== 0 && d.getDay() !== 6)) choices.push(d);
  }
  return formatDate(choices[Math.floor(random() * choices.length)] || start, rule.format);
}

// The values for one row. Returns [{ label, value, note? }]; a value of null means "ask".
export function valuesForRow(rules, row, opts = {}) {
  return rules.map(r => {
    if (r.type === 'column') {
      const cell = String(row[r.column] ?? '').trim();
      if (!cell) return { label: r.label, value: '', note: r.note ? `blank in the sheet. The human's note: ${r.note}` : `blank in the sheet (column ${r.column})` };
      const value = r.action === 'select' ? (closestOption(cell, r.options) || cell) : cell;
      return { label: r.label, value };
    }
    if (r.type === 'generated') return { label: r.label, value: generateValue(r, opts) };
    if (r.type === 'fixed') return { label: r.label, value: r.value };
    if (r.type === 'ask') return { label: r.label, value: opts.answers?.[r.label] ?? null };
    return { label: r.label, value: '', note: `the human's note: ${r.note} (example: ${r.value})` };
  });
}

// The goal for one row: the skill, then every value to fill in. "Label = value" pairs keep
// colons and commas in values (times, addresses) unambiguous.
export function rowGoal(skill, n, total, values) {
  // "; " separates the pairs, so it can't appear inside one.
  const safe = t => String(t).replace(/;\s*/g, ', ');
  const pairs = values.map(v => `${safe(v.label)} = ${safe(v.value || `(${v.note})`)}`);
  return `${skill} (row ${n} of ${total}). Fill in: ${pairs.join('; ')}`;
}

// The other way round, for anything that needs the values back from a goal.
export function parseRowGoal(goal) {
  const m = String(goal).match(/Fill in: (.*)$/s);
  if (!m) return null;
  return Object.fromEntries(m[1].split('; ').map(p => p.split(' = ')).filter(p => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
}

// Plain words for a rule, for the review card.
export function describeRule(r) {
  if (r.type === 'column') return `from column “${r.column}”`;
  if (r.type === 'generated') return r.kind === 'random-weekday' ? `a random weekday in the next ${r.days} days` : r.kind === 'random-date' ? `a random date in the next ${r.days} days` : r.kind;
  if (r.type === 'ask') return 'ask me for each row';
  if (r.type === 'note') return `your note: “${r.note}”`;
  return `always “${r.value}”`;
}

// A stable key for a row, so a rerun skips rows already done.
export const rowKey = row => JSON.stringify(Object.entries(row).sort());
