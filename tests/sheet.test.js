// Sheet to form: reading rows, working out field rules from one taught row, and the values
// for every other row.
//   node --test tests/sheet.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toTable, inferRules, valuesForRow, rowGoal, parseRowGoal, closestOption, generatedFromNote, generateValue, describeRule } from '../extension/sheet-core.js';

test('CSV: quotes, commas and newlines inside quotes, no-header columns dropped', () => {
  const t = parseCsv('Name,Email,Note\n"Okafor, Sam",sam@x.example,"two\nlines"\n,,\nLena,lena@x.example,"say ""hi"""\n');
  assert.deepEqual(t.columns, ['Name', 'Email', 'Note']);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0].Name, 'Okafor, Sam');
  assert.equal(t.rows[0].Note, 'two\nlines');
  assert.equal(t.rows[1].Note, 'say "hi"');
  assert.deepEqual(toTable([['', 'A'], ['1', 'x']]), { columns: ['A'], rows: [{ A: 'x' }] });
});

test('closest dropdown option: exact, then a prefix ("Eng" → Engineering), else none', () => {
  const options = ['Engineering', 'Sales', 'Operations'];
  assert.equal(closestOption('sales', options), 'Sales');
  assert.equal(closestOption('Eng', options), 'Engineering');
  assert.equal(closestOption('Legal', options), null);
});

test('notes that ask for a value code can make', () => {
  assert.deepEqual(generatedFromNote('Pick a random weekday in the next two weeks, not in the sheet', '05/11/2026'), { kind: 'random-weekday', days: 14, format: 'DD/MM/YYYY' });
  assert.equal(generatedFromNote('use today', '2026-10-24').format, 'YYYY-MM-DD');
  assert.equal(generatedFromNote('ask Grace first', 'x'), null);
  const today = new Date(2026, 9, 24); // a Saturday
  for (let i = 0; i < 50; i++) {
    const v = generateValue({ kind: 'random-weekday', days: 14, format: 'DD/MM/YYYY' }, { today });
    const [d, m, y] = v.split('/').map(Number);
    const date = new Date(y, m - 1, d);
    assert.ok(date > today && date - today <= 14 * 86400000, v);
    assert.ok(date.getDay() !== 0 && date.getDay() !== 6, `${v} is a weekday`);
  }
});

const columns = ['Full name', 'Email', 'Dept', 'Manager'];
const row1 = { 'Full name': 'Kofi Mensah', Email: 'kofi.mensah@acme.example', Dept: 'Engineering', Manager: 'Priya Shah' };
const taught = [
  { action: 'type', label: 'Full name', role: 'textbox', value: 'Kofi Mensah' },
  { action: 'type', label: 'Work email', role: 'textbox', value: 'kofi.mensah@acme.example' },
  { action: 'select', label: 'Team', role: 'select', value: 'Engineering', note: 'If Dept is blank, use Operations',
    page: { elements: [{ label: 'Team', options: ['Engineering', 'Sales', 'Operations', 'Finance', 'People'] }] } },
  { action: 'type', label: 'Manager', role: 'textbox', value: 'Priya Shah' },
  { action: 'type', label: 'Start date', role: 'textbox', value: '05/11/2026', note: 'Pick a random weekday in the next two weeks. It is not in the sheet.' },
  { action: 'select', label: 'Laptop', role: 'select', value: 'MacBook Air' },
  { action: 'click', label: 'Submit', role: 'button', value: '' },
];

test('one taught row → a rule per field: columns, a generated date, a fixed value', () => {
  const rules = inferRules(taught, row1, columns);
  assert.deepEqual(rules.map(r => [r.label, r.type, r.column || r.kind || r.value]), [
    ['Full name', 'column', 'Full name'], ['Work email', 'column', 'Email'], ['Team', 'column', 'Dept'],
    ['Manager', 'column', 'Manager'], ['Start date', 'generated', 'random-weekday'], ['Laptop', 'fixed', 'MacBook Air'],
  ]);
  assert.equal(describeRule(rules[4]), 'a random weekday in the next 14 days');
});

test('values for other rows: dropdown matched, blank cells carry the note, goal round-trips', () => {
  const rules = inferRules(taught, row1, columns);
  const tunde = valuesForRow(rules, { 'Full name': 'Tunde Bello', Email: 't@acme.example', Dept: 'Eng', Manager: 'Priya Shah' }, { today: new Date(2026, 9, 24) });
  assert.equal(tunde.find(v => v.label === 'Team').value, 'Engineering');
  assert.equal(tunde.find(v => v.label === 'Laptop').value, 'MacBook Air');
  const sam = valuesForRow(rules, { 'Full name': 'Sam Okafor', Email: 's@acme.example', Dept: '', Manager: 'Grace Okoro' });
  assert.match(sam.find(v => v.label === 'Team').note, /If Dept is blank, use Operations/);
  const goal = rowGoal('Add a new starter', 3, 10, tunde);
  assert.match(goal, /^Add a new starter \(row 3 of 10\)\. Fill in: Full name = Tunde Bello; Work email = t@acme\.example; Team = Engineering/);
  assert.equal(parseRowGoal(goal).Manager, 'Priya Shah');
});
