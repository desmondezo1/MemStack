// Sends varied, realistic next-action and done-check calls through Mubit so both
// tasks reach the 25 kept examples Mubit needs before it trains a first adapter.
// Uses exactly the same system prompts and message builders as the live agent,
// so every call lands in the same Mubit task.
//
//   npm run seed                      # 60 next-action + 20 done-check calls
//   npm run seed -- --count 30 --checks 10
//   npm run seed -- --dry-run         # print one example message, send nothing

import { loadEnv } from '../server/env.js';
import { TASKS, buildNextActionMessage, buildDoneCheckMessage } from '../server/prompts.js';

loadEnv();
const { callTask, getConfig } = await import('../server/llm.js');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const dryRun = args.includes('--dry-run');
const COUNT = flag('count', 60);
const CHECKS = flag('checks', 20);
const CONCURRENCY = flag('concurrency', 3);

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six'];
const NAMES = ['Ada', 'Tunde', 'Priya', 'Sam Okafor', 'Lena', 'Kofi', 'Mia Chen', 'Desmond'];

let idCounter = 1;
const el = (role, label, extra = {}) => ({ id: `e${idCounter++}`, role, label, ...extra });

// Each generator returns one decision point: a page, a goal and the steps taken so far.
const generators = [
  function restaurant() {
    idCounter = Math.floor(Math.random() * 20) + 1;
    const name = pick(['Trattoria Nove', 'Casa Lume', 'The Brass Fig', 'Mangal Yard', 'Suya Spot']);
    const n = Math.floor(Math.random() * 5) + 1;
    const time = pick(['seven', 'eight', 'half past seven', 'nine', '8pm', '19:30']);
    const goal = pick([`Book a table for ${NUMBERS[n]} at ${time}`, `Reserve a table for ${n} people at ${time} tonight`, `Get us a table for ${NUMBERS[n]} at ${time} tomorrow`]);
    const els = [
      el('select', 'Party size', { value: '', options: ['1', '2', '3', '4', '5', '6', '7', '8'] }),
      el('select', pick(['Day', 'Date']), { value: 'Tonight', options: ['Tonight', 'Tomorrow', 'Saturday'] }),
      ...shuffle(['A', 'B', 'C', 'D']).slice(0, 4).sort().map(s => el('radio', `Sitting ${s}`, { group: 'Sitting', checked: false })),
      el('textbox', 'Name for the booking', { value: '' }),
      el('button', pick(['Reserve table', 'Book now', 'Confirm booking'])),
    ];
    const history = [];
    const stage = Math.floor(Math.random() * 3);
    if (stage >= 1) { els[0].value = String(n); history.push({ action: 'select', label: 'Party size', role: 'select', value: String(n) }); }
    if (stage >= 2) { els[2].checked = true; history.push({ action: 'click', label: els[2].label, role: 'radio', value: '' }); }
    const withPopup = stage === 0 && Math.random() < 0.4;
    const elements = withPopup
      ? [el('button', 'Subscribe', { inDialog: true }), el('button', pick(['No thanks', 'Not now', 'Close']), { inDialog: true })]
      : els;
    const lesson = {
      goal: 'Book a table for two at eight',
      steps: [
        { action: 'select', label: 'Party size', role: 'select', value: '2' },
        { action: 'click', label: 'Sitting C', role: 'radio', value: '' },
        { action: 'type', label: 'Name for the booking', role: 'textbox', value: 'Alex' },
        { action: 'click', label: els[els.length - 1].label, role: 'button', value: '' },
      ],
    };
    return { goal, page: { url: `https://${name.toLowerCase().replace(/\W+/g, '')}.example/book`, title: `${name} — Book a table`, headings: [name, 'Book a table'], elements }, history, lesson };
  },

  function signup() {
    idCounter = Math.floor(Math.random() * 30) + 1;
    const person = pick(NAMES);
    const email = `${person.split(' ')[0].toLowerCase()}@example.com`;
    const goal = pick([`Sign me up for the newsletter as ${email}`, `Create an account for ${person} with ${email}`, `Register ${email} for the beta waitlist`]);
    const elements = [
      el('link', 'Pricing'), el('link', 'Log in'),
      el('textbox', 'Full name', { value: '' }), el('textbox', 'Work email', { value: '' }),
      el('checkbox', 'I agree to the terms', { checked: false }),
      el('button', pick(['Join the waitlist', 'Create account', 'Sign up'])),
    ];
    const history = [];
    if (Math.random() < 0.5) { elements[2].value = person; history.push({ action: 'type', label: 'Full name', role: 'textbox', value: person }); }
    return { goal, page: { url: 'https://app.example/signup', title: 'Sign up', headings: ['Get early access'], elements }, history };
  },

  function search() {
    idCounter = Math.floor(Math.random() * 40) + 1;
    const item = pick(['wireless earbuds', 'running shoes size 10', 'a USB-C hub', 'a standing desk', 'noise cancelling headphones']);
    const goal = pick([`Search for ${item}`, `Find ${item} under £100`, `Look up ${item} and sort by price`]);
    const elements = [
      el('link', 'Home'), el('link', 'Deals'), el('textbox', 'Search products', { value: '' }),
      el('button', 'Search'), el('select', 'Sort by', { value: 'Relevance', options: ['Relevance', 'Price: low to high', 'Price: high to low', 'Rating'] }),
      el('link', 'Basket (0)'),
    ];
    const history = [];
    if (Math.random() < 0.5) { elements[2].value = item; history.push({ action: 'type', label: 'Search products', role: 'textbox', value: item }); }
    return { goal, page: { url: 'https://shop.example/', title: 'Shop', headings: ['Shop everything'], elements }, history };
  },

  function cookieBanner() {
    idCounter = Math.floor(Math.random() * 10) + 1;
    const goal = pick(['Read the latest article', 'Open the pricing page', 'Check the opening hours', 'Find the contact page']);
    const elements = [
      el('button', pick(['Accept all', 'Allow all cookies']), { inDialog: true }),
      el('button', pick(['Reject all', 'Necessary only', 'Reject non-essential']), { inDialog: true }),
      el('link', 'Manage preferences', { inDialog: true }),
    ];
    return { goal, page: { url: 'https://news.example/', title: 'News', headings: ['We value your privacy'], elements }, history: [] };
  },

  function blankStart() {
    const goal = pick([
      `Open YouTube and play a ${pick(['Burna Boy', 'Tems', 'Wizkid', 'Asake', 'Adele'])} video`,
      `Go to Wikipedia and look up ${pick(['Lagos', 'the Thames', 'Alan Turing', 'jollof rice'])}`,
      'Check the weather in London on the BBC',
      `Search Google for ${pick(['cheap flights to Lagos', 'best ramen in Soho', 'hackathons in London'])}`,
      `Find ${pick(['running shoes', 'a USB-C hub', 'noise cancelling headphones'])} on Amazon`,
    ]);
    return { goal, page: { url: 'chrome://newtab/', title: 'New Tab', headings: [], elements: [], note: 'none (browser start page: use open_url to go to a site)' }, history: [] };
  },

  function videoResults() {
    idCounter = Math.floor(Math.random() * 60) + 1;
    const artist = pick(['Burna Boy', 'Tems', 'Wizkid', 'Asake', 'Adele']);
    const goal = pick([`Play a ${artist} video`, `Open YouTube and play ${artist}`, `Watch ${artist} live`]);
    const searched = Math.random() < 0.6;
    const elements = [
      el('link', 'YouTube Home'), el('textbox', 'Search', { value: searched ? artist : '' }), el('button', 'Search'),
      el('button', 'Search with your voice'), el('link', 'Shorts'), el('link', 'Subscriptions'),
      ...(searched ? shuffle([`${artist} - Official Music Video`, `${artist} live at Glastonbury`, `${artist} interview`, `Best of ${artist} playlist`])
        .map(t => el('link', `${t} 12M views 2 years ago`)) : [el('link', 'Trending video 1M views'), el('link', 'Lo-fi beats 3M views')]),
    ];
    const history = searched
      ? [{ action: 'open_url', label: null, role: null, value: `https://www.youtube.com/results?search_query=${encodeURIComponent(artist)}` }]
      : [{ action: 'open_url', label: null, role: null, value: 'https://www.youtube.com' }];
    const url = searched ? `https://www.youtube.com/results?search_query=${encodeURIComponent(artist)}` : 'https://www.youtube.com/';
    return { goal, page: { url, title: 'YouTube', headings: [], scroll: '0% down, 412 controls on the page', elements }, history };
  },

  function support() {
    idCounter = Math.floor(Math.random() * 25) + 1;
    const order = `#${Math.floor(10000 + Math.random() * 90000)}`;
    const goal = pick([`Ask support where order ${order} is`, `Request a refund for order ${order}`, `Report that order ${order} arrived damaged`]);
    const elements = [
      el('select', 'Topic', { value: '', options: ['Delivery', 'Refunds', 'Damaged item', 'Account', 'Other'] }),
      el('textbox', 'Order number', { value: '' }), el('textbox', 'Message', { value: '' }),
      el('button', 'Send message'), el('link', 'Help centre'),
    ];
    return { goal, page: { url: 'https://help.example/contact', title: 'Contact us', headings: ['How can we help?'], elements }, history: [] };
  },
];

// About a third of restaurant calls carry a recalled lesson, as the live agent's do
// after a "show me". Lessons are always sensible: a wrong lesson would train a wrong adapter.
function maybeDemo(sample) {
  if (!sample.lesson || Math.random() > 0.35) return null;
  return sample.lesson;
}

const doneTexts = [
  goal => `Booking confirmed. Table for 2 guests, Tonight, Sitting C (20:00). See you soon, Ada.`,
  goal => `Booking confirmed. Table for 4 guests, Tomorrow, Sitting A (17:30). See you soon, Kofi.`,
  goal => `Please choose a sitting, a name.`,
  goal => `Thanks! You're on the waitlist. We sent a confirmation to priya@example.com.`,
  goal => `Search results for "running shoes size 10" — 48 results, sorted by Price: low to high.`,
  goal => `Message sent. We'll reply about order #48213 within 24 hours.`,
];
const checkGoals = ['Book a table for two at eight', 'Book a table for four at half past five tomorrow', 'Sign me up for the beta waitlist as priya@example.com', 'Find running shoes size 10 sorted by price', 'Ask support where order #48213 is'];

async function runPool(jobs) {
  let ok = 0, failed = 0, next = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        await jobs[i]();
        ok++;
      } catch (err) {
        failed++;
        console.error(`  call ${i + 1} failed: ${err.message}`);
        if (/401|403|starter_credit/.test(err.message)) throw err;
      }
      if ((ok + failed) % 10 === 0) console.log(`  ${ok + failed}/${jobs.length} (${failed} failed)`);
    }
  });
  await Promise.all(workers);
  return { ok, failed };
}

const config = getConfig();
if (dryRun) {
  const s = pick(generators)();
  console.log(buildNextActionMessage({ goal: s.goal, page: s.page, history: s.history, demo: maybeDemo(s) }));
  process.exit(0);
}
if (config.provider === 'mock') {
  console.error('No MUBIT_API_KEY in .env, so there is nothing to seed. Add your key (see .env.example) and run again.');
  process.exit(1);
}

console.log(`Seeding through Mubit: ${COUNT} next-action + ${CHECKS} done-check calls on ${config.provider} / ${config.model}`);
const jobs = [];
for (let i = 0; i < COUNT; i++) {
  jobs.push(async () => {
    const s = pick(generators)();
    await callTask({ task: TASKS.nextAction, userMessage: buildNextActionMessage({ goal: s.goal, page: s.page, history: s.history, demo: maybeDemo(s) }), sessionId: `seed-na-${Date.now()}-${i}`, kind: 'live' });
  });
}
for (let i = 0; i < CHECKS; i++) {
  jobs.push(async () => {
    const goal = pick(checkGoals);
    const page = { url: 'https://example.app/result', text: pick(doneTexts)(goal) };
    await callTask({ task: TASKS.doneCheck, userMessage: buildDoneCheckMessage({ goal, page }), sessionId: `seed-dc-${Date.now()}-${i}`, kind: 'live' });
  });
}
let ok, failed;
try {
  ({ ok, failed } = await runPool(jobs));
} catch (err) {
  console.error(`Stopped: ${err.message}`);
  console.error('Check MUBIT_API_KEY, how calls are paid (starter credit or provider key) and MUBIT_MODEL in .env.');
  process.exit(1);
}
console.log(`Done: ${ok} sent, ${failed} failed. Open Mubit → Tasks to watch "next-action" and "done-check" count towards 25.`);
