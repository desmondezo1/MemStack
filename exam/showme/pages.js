// Page snapshots of Mo's two demo sites, shaped like extension/content.js output:
// same roles, labels, element ids, headings and visible text. The seed script and the
// held-out exam both build their next-action messages from these, so the adapter
// trains on the pages the live demo sends.

export const DEMO_ORIGIN = 'http://localhost:8787';
export const TRATTORIA_URL = `${DEMO_ORIGIN}/demo/`;
export const TUBE_URL = `${DEMO_ORIGIN}/demo/tube/`;

const PARTY_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8'];
const DAYS = ['Tonight', 'Tomorrow', 'Saturday'];
export const SITTINGS = { A: '17:30', B: '18:45', C: '20:00', D: '21:15' };

const INFO_TEXT = 'Opening hours Monday Closed Tuesday to Saturday 12:00–23:00 Sunday 12:00–21:00, Sunday roast until 16:00';
const NEWSLETTER_TEXT = 'Join the Nove table Get first dibs on truffle season and our supper clubs. Subscribe No thanks';

// The newsletter pop-up opens on load, so its two buttons are seen first and take e1, e2;
// the form's controls get e3..e10 once it is dismissed.
export const TRATTORIA_IDS = {
  subscribe: 'e1', noThanks: 'e2', party: 'e3', day: 'e4',
  sitting: { A: 'e5', B: 'e6', C: 'e7', D: 'e8' }, name: 'e9', reserve: 'e10', again: 'e11',
};

// state: { dialog, party, day, sitting ('A'..'D'), name, error, confirmed: { party, day, sitting, name } }
export function trattoria(state = {}) {
  const ids = TRATTORIA_IDS;
  const base = { url: TRATTORIA_URL, title: 'Trattoria Nove — Book a table' };
  if (state.dialog) {
    return {
      ...base,
      headings: ['Trattoria Nove', 'Book a table', 'Opening hours', 'Good to know'],
      scroll: '0% down, 10 controls on the page',
      text: `Trattoria Nove Seasonal Roman cooking · Hackney Book a table Party size Choose… 1 2 3 4 5 6 7 8 Day Tonight Tomorrow Saturday Sitting Sitting A Sitting B Sitting C Sitting D Hover a sitting to see its time. Name for the booking Reserve table ${INFO_TEXT} ${NEWSLETTER_TEXT}`,
      elements: [
        { id: ids.subscribe, role: 'button', label: 'Subscribe', inDialog: true },
        { id: ids.noThanks, role: 'button', label: 'No thanks', inDialog: true },
      ],
    };
  }
  if (state.confirmed) {
    const c = state.confirmed;
    const guests = c.party === '1' ? '1 guest' : `${c.party} guests`;
    return {
      ...base,
      headings: ['Trattoria Nove', 'Booking confirmed', 'Opening hours', 'Good to know'],
      text: `Trattoria Nove Seasonal Roman cooking · Hackney Booking confirmed Table for ${guests}, ${c.day}, Sitting ${c.sitting} (${SITTINGS[c.sitting]}). See you soon, ${c.name}. Make another booking ${INFO_TEXT}`,
      elements: [{ id: ids.again, role: 'button', label: 'Make another booking' }],
    };
  }
  const day = state.day || 'Tonight';
  const error = state.error ? ` ${state.error}` : '';
  return {
    ...base,
    headings: ['Trattoria Nove', 'Book a table', 'Opening hours', 'Good to know'],
    scroll: '0% down, 8 controls on the page',
    text: `Trattoria Nove Seasonal Roman cooking · Hackney Book a table Party size ${state.party || 'Choose…'} 1 2 3 4 5 6 7 8 Day ${day} Tonight Tomorrow Saturday Sitting Sitting A Sitting B Sitting C Sitting D Hover a sitting to see its time. Name for the booking ${state.name || ''} Reserve table${error} ${INFO_TEXT}`,
    elements: [
      { id: ids.party, role: 'select', label: 'Party size', value: state.party || '', options: PARTY_OPTIONS },
      { id: ids.day, role: 'select', label: 'Day', value: day, options: DAYS },
      ...Object.keys(SITTINGS).map(s => ({ id: ids.sitting[s], role: 'radio', label: `Sitting ${s}`, group: 'Sitting', checked: state.sitting === s })),
      { id: ids.name, role: 'textbox', label: 'Name for the booking', value: state.name || '' },
      { id: ids.reserve, role: 'button', label: 'Reserve table' },
    ],
  };
}

// The demonstration a human records on Trattoria Nove in the demo: the 20:00 sitting is C,
// which only a hover shows. Recalled into later next-action calls on this page.
export function trattoriaLesson({ goal = 'Book a table for two at eight', party = '2', sitting = 'C', name = 'Alex' } = {}) {
  return {
    goal,
    steps: [
      { action: 'click', label: 'No thanks', role: 'button', value: '' },
      { action: 'select', label: 'Party size', role: 'select', value: party },
      { action: 'click', label: `Sitting ${sitting}`, role: 'radio', value: '' },
      { action: 'type', label: 'Name for the booking', role: 'textbox', value: name },
      { action: 'click', label: 'Reserve table', role: 'button', value: '' },
    ],
  };
}

const titleCase = q => q.replace(/\b\w/g, c => c.toUpperCase());
const videoLabel = title => `▶ ${title} Tubely · 1.2M views`;
export const TUBE_HOME_VIDEOS = ['Lagos street food tour', 'Premier League highlights', 'How to make jollof rice', 'Lo-fi beats to study to'];
export const resultTitles = q => {
  const nice = titleCase(q);
  return [`${nice} — Official Music Video`, `${nice} live at Wembley`, `${nice} interview`, `Best of ${nice} (playlist)`, `${nice} reaction video`, `${nice} documentary`];
};

// Header controls are e1..e3 on every Tubely page (a fresh page each time).
export function tubelyHome() {
  return {
    url: TUBE_URL,
    title: 'Tubely',
    headings: ['Trending'],
    text: `▶Tubely Home Music News Sport Trending ${TUBE_HOME_VIDEOS.map(t => `▶ ${t} Tubely · 1.2M views`).join(' ')}`,
    elements: [
      { id: 'e1', role: 'link', label: '▶Tubely' },
      { id: 'e2', role: 'combobox', label: 'Search videos' },
      { id: 'e3', role: 'button', label: 'Search' },
      ...['Home', 'Music', 'News', 'Sport'].map((label, i) => ({ id: `e${4 + i}`, role: 'link', label })),
      ...TUBE_HOME_VIDEOS.map((t, i) => ({ id: `e${8 + i}`, role: 'link', label: videoLabel(t) })),
    ],
  };
}

// Results for q; the video links are e4..e9 in the order resultTitles(q) gives.
export function tubelyResults(q) {
  const titles = resultTitles(q);
  return {
    url: `${TUBE_URL}results.html?q=${encodeURIComponent(q)}`,
    title: 'Search — Tubely',
    headings: [`Results for “${q}”`],
    text: `▶Tubely Results for “${q}” ${titles.map(t => `▶ ${t} Tubely · 1.2M views`).join(' ')}`,
    elements: [
      { id: 'e1', role: 'link', label: '▶Tubely' },
      { id: 'e2', role: 'textbox', label: 'Search videos', value: q },
      { id: 'e3', role: 'button', label: 'Search' },
      ...titles.map((t, i) => ({ id: `e${4 + i}`, role: 'link', label: videoLabel(t) })),
    ],
  };
}

// The watch page; the play button is e4.
export function tubelyWatch(title, { playing = false } = {}) {
  return {
    url: `${TUBE_URL}watch.html?t=${encodeURIComponent(title)}`,
    title: `${title} — Tubely`,
    headings: [title],
    text: `▶Tubely ${playing ? '❚❚ Pause' : '▶ Play'} ${title} ${playing ? `Now playing: ${title}` : 'Paused'}`,
    elements: [
      { id: 'e1', role: 'link', label: '▶Tubely' },
      { id: 'e2', role: 'textbox', label: 'Search videos', value: '' },
      { id: 'e3', role: 'button', label: 'Search' },
      { id: 'e4', role: 'button', label: playing ? '❚❚ Pause' : '▶ Play' },
    ],
  };
}

export const NEW_TAB = { url: 'chrome://newtab/', title: 'New Tab', headings: [], elements: [], note: 'none (browser start page: use open_url to go to a site)' };

// Iron Gym, the cancel-your-membership maze. view: account | paused | manage | cancel | offer | kept | confirm | done.
// state for cancel: { reason, end ('period' | 'now'), addon (bool), error }; for done: { reason, end, addon }.
export const GYM_URL = `${DEMO_ORIGIN}/demo/gym/`;
export const GYM_REASONS = ['Too expensive', 'Moving away', 'Injury', 'Not using it enough', 'Other'];
const GYM_END = { period: 'At the end of this billing period (2 November)', now: 'Immediately, with a refund for unused days' };
export const GYM_ADDON = 'Keep my Recovery+ add-on (£9 a month)';
const GYM_TOP = 'Demo gym for testing Mo. Nothing here is real, and nothing is charged. IRONGYM Classes Trainers My bookings';
const gymNav = () => ['Classes', 'Trainers', 'My bookings'].map((label, i) => ({ id: `e${i + 1}`, role: 'link', label }));

export function gym(view = 'account', state = {}) {
  const base = { url: GYM_URL, title: 'Iron Gym · Members' };
  const els = labels => [...gymNav(), ...labels.map((e, i) => ({ id: `e${i + 4}`, ...e }))];
  const btn = label => ({ role: 'button', label });
  if (view === 'account') return { ...base, headings: ['Hi Ada 👋'],
    text: `${GYM_TOP} Hi Ada 👋 You're on a 42-day streak. Keep it up! Iron Gym Plus £39 a month · renews 2 November + Recovery+ add-on £9 Pause my membership (recommended) Book a class Manage plan`,
    elements: els([btn('Pause my membership (recommended)'), btn('Book a class'), btn('Manage plan')]) };
  if (view === 'paused') return { ...base, headings: ['Membership paused for 1 month'],
    text: `${GYM_TOP} Membership paused for 1 month Your membership is paused, not cancelled. You'll be charged £5 a month while it's paused, and it restarts on 2 December. Back to my account`,
    elements: els([btn('Back to my account')]) };
  if (view === 'manage') return { ...base, headings: ['Your plan'],
    text: `${GYM_TOP} Your plan Iron Gym Plus · £39 a month Upgrade to Iron Gym Max Change home club Freeze membership Cancel membership`,
    elements: els([btn('Upgrade to Iron Gym Max'), btn('Change home club'), btn('Freeze membership'), btn('Cancel membership')]) };
  if (view === 'cancel') {
    const end = state.end || 'period', addon = state.addon ?? true;
    return { ...base, headings: ['Cancel your membership'],
      text: `${GYM_TOP} Cancel your membership Why are you leaving? ${state.reason || 'Choose a reason…'} When should it end? ${GYM_END.period} ${GYM_END.now} ${GYM_ADDON}${state.error ? ` ${state.error}` : ''} Continue`,
      elements: els([
        { role: 'select', label: 'Why are you leaving?', value: state.reason || '', options: GYM_REASONS },
        { role: 'radio', label: GYM_END.period, group: 'When should it end?', checked: end === 'period' },
        { role: 'radio', label: GYM_END.now, group: 'When should it end?', checked: end === 'now' },
        { role: 'checkbox', label: GYM_ADDON, checked: addon },
        btn('Continue'),
      ]) };
  }
  if (view === 'offer') return { ...base, headings: ['Wait, Ada! Don\'t lose your streak'],
    text: `${GYM_TOP} Wait, Ada! Don't lose your streak 50% off Stay for three more months at half price. Accept offer No thanks, continue cancelling`,
    elements: els([btn('Accept offer'), btn('No thanks, continue cancelling')]) };
  if (view === 'kept') return { ...base, headings: ['Great, you\'re staying! 🎉'],
    text: `${GYM_TOP} Great, you're staying! 🎉 Your membership continues at 50% off for 3 months. It has not been cancelled. Back to my account`,
    elements: els([btn('Back to my account')]) };
  if (view === 'confirm') return { ...base, headings: ['Are you sure? 😢'],
    text: `${GYM_TOP} Are you sure? 😢 You'll lose your 42-day streak and all your class history. Keep my membership Yes, cancel my membership`,
    elements: els([btn('Keep my membership'), btn('Yes, cancel my membership')]) };
  return { ...base, headings: ['Membership cancelled ✓'], text: `${GYM_TOP} ${gymDoneText(state)} Back to my account Back to your inbox`, elements: els([btn('Back to my account'), { role: 'link', label: 'Back to your inbox' }]) };
}

export function gymDoneText({ reason = 'Moving away', end = 'now', addon = false } = {}) {
  return `Membership cancelled ✓ Iron Gym Plus ends: ${end === 'now' ? 'today (refund for unused days on its way)' : '2 November'} Reason: ${reason} `
    + (addon ? 'Your Recovery+ add-on is still active, so you will keep being charged £9 a month.' : 'Recovery+ add-on: cancelled. No more charges.');
}

// Ada's way out, as she shows it once: now, no add-on, no offer.
export function gymLesson({ goal = 'Cancel my Iron Gym membership', reason = 'Moving away' } = {}) {
  return {
    goal,
    steps: [
      { action: 'click', label: 'Manage plan', role: 'button', value: '' },
      { action: 'click', label: 'Cancel membership', role: 'button', value: '' },
      { action: 'select', label: 'Why are you leaving?', role: 'select', value: reason },
      { action: 'click', label: GYM_END.now, role: 'radio', value: '' },
      { action: 'click', label: GYM_ADDON, role: 'checkbox', value: '' },
      { action: 'click', label: 'Continue', role: 'button', value: '' },
      { action: 'click', label: 'No thanks, continue cancelling', role: 'button', value: '' },
      { action: 'click', label: 'Yes, cancel my membership', role: 'button', value: '' },
    ],
  };
}

// The page Mo sees after the first `stage` steps of the lesson.
export function gymAfter(stage, reason) {
  return [
    gym('account'), gym('manage'), gym('cancel'), gym('cancel', { reason }), gym('cancel', { reason, end: 'now' }),
    gym('cancel', { reason, end: 'now', addon: false }), gym('offer'), gym('confirm'), gym('done', { reason }),
  ][stage];
}

// Ada's inbox (Postbox), an email in it, and a sender's email preferences page.
import { EMAILS, SENDERS } from '../../server/demo-site/inbox/mail.js';
export const INBOX_URL = `${DEMO_ORIGIN}/demo/inbox/`;
export const MARKETING = Object.keys(SENDERS).filter(k => SENDERS[k].kind === 'marketing' && EMAILS.some(e => e.sender === k && e.unsubscribe));
const INBOX_TOP = 'Demo inbox for testing Mo. Every email, brand and address here is made up. Postbox ada@example.com Inbox Starred Sent Drafts Spam';
const inboxBase = { url: INBOX_URL, title: 'Inbox · Ada · Postbox' };
const rowLabel = e => `${e.name} ${e.subject} ${e.time}`;

export function inboxList(query = '') {
  const found = EMAILS.filter(e => !query || `${e.name} ${e.subject}`.toLowerCase().includes(query.toLowerCase())).slice(0, 25);
  return { ...inboxBase, headings: [], scroll: '0% down, 31 controls on the page',
    text: `${INBOX_TOP} ${query ? `${found.length} results for “${query}”` : '1–25 of 100'} ${found.slice(0, 6).map(rowLabel).join(' ')}`,
    elements: [
      { id: 'e1', role: 'searchbox', label: 'Search mail', value: query }, { id: 'e2', role: 'button', label: 'Search' },
      { id: 'e3', role: 'button', label: 'Older' },
      ...found.map((e, i) => ({ id: `e${i + 4}`, role: 'link', label: rowLabel(e) })),
    ] };
}

export function inboxMail(email) {
  const links = [{ role: 'button', label: '← Back to inbox' }];
  if (email.cta) links.push({ role: 'link', label: email.cta });
  if (email.unsubscribe) links.push({ role: 'link', label: 'Unsubscribe' }, { role: 'link', label: 'Email preferences' });
  else if (email.phishing) links.push({ role: 'link', label: 'unsubscribe here' });
  return { ...inboxBase, headings: [email.subject],
    text: `${INBOX_TOP} ← Back to inbox ${email.subject} ${email.name} <${email.from}> · ${email.time} ${email.body.join(' ')} ${email.cta || ''}`,
    elements: links.map((l, i) => ({ id: `e${i + 1}`, ...l })) };
}

const UNSUB_BOXES = ['Weekly deals and offers', 'Offers from our partners', 'Order and delivery updates'];
// ticks: [deals, partners, orders]
export function unsubscribePage(sender, ticks = [true, true, true]) {
  const name = SENDERS[sender].name;
  return { url: `${DEMO_ORIGIN}/demo/inbox/unsubscribe.html?s=${sender}`, title: `${name} · Email preferences`, headings: ['Sorry to see you go, Ada', 'Choose what you get'],
    text: `Demo email preferences page for testing Mo. Nothing here is real. ${name} Sorry to see you go, Ada You're signed up as ada@example.com. Pause all emails for 30 days (recommended) Choose what you get ${UNSUB_BOXES.join(' ')} Save preferences Unsubscribe from all emails`,
    elements: [
      { id: 'e1', role: 'button', label: 'Pause all emails for 30 days (recommended)' },
      ...UNSUB_BOXES.map((label, i) => ({ id: `e${i + 2}`, role: 'checkbox', label, checked: ticks[i] })),
      { id: 'e5', role: 'button', label: 'Save preferences' },
      { id: 'e6', role: 'button', label: 'Unsubscribe from all emails' },
    ] };
}

// What Ada showed once: no marketing, but keep order and delivery updates.
export function unsubscribeLesson(sender = 'dealdash') {
  const first = EMAILS.find(e => e.sender === sender && e.unsubscribe);
  return {
    goal: `Unsubscribe me from ${SENDERS[sender].name} emails`,
    steps: [
      { action: 'click', label: rowLabel(first), role: 'link', value: '' },
      { action: 'click', label: 'Unsubscribe', role: 'link', value: '' },
      { action: 'click', label: 'Weekly deals and offers', role: 'checkbox', value: 'untick' },
      { action: 'click', label: 'Offers from our partners', role: 'checkbox', value: 'untick' },
      { action: 'click', label: 'Save preferences', role: 'button', value: '' },
    ],
  };
}
export const firstMailFrom = sender => EMAILS.find(e => e.sender === sender && e.unsubscribe);
export const inboxRowLabel = rowLabel;

// Calmly, the meditation app Ada pays for but doesn't use.
export const CALMLY_URL = `${DEMO_ORIGIN}/demo/calmly/`;
export function calmly(view = 'account') {
  const base = { url: CALMLY_URL, title: 'Calmly · Your account' };
  const top = 'Demo app for testing Mo. Nothing here is real, and nothing is charged. calmly';
  const els = list => list.map((label, i) => ({ id: `e${i + 1}`, role: 'button', label }));
  if (view === 'account') return { ...base, headings: ['Hi Ada 🌿'], text: `${top} Hi Ada 🌿 This month: 0 minutes of calm. Calmly Premium £6.99 a month · renews 3 November Pause my subscription (3 months free) Start a 5-minute session Manage subscription`,
    elements: els(['Pause my subscription (3 months free)', 'Start a 5-minute session', 'Manage subscription']) };
  if (view === 'manage') return { ...base, headings: ['Your subscription'], text: `${top} Your subscription Calmly Premium · £6.99 a month Switch to yearly and save 40% Gift Calmly to a friend Cancel subscription`,
    elements: els(['Switch to yearly and save 40%', 'Gift Calmly to a friend', 'Cancel subscription']) };
  if (view === 'offer') return { ...base, headings: ['Before you go: have a month on us'], text: `${top} Before you go: have a month on us Stay with Calmly and your next month is free. Claim my free month No thanks, cancel my subscription`,
    elements: els(['Claim my free month', 'No thanks, cancel my subscription']) };
  return { ...base, headings: ['Subscription cancelled ✓'], text: `${top} Subscription cancelled ✓ You won't be charged on 3 November. You can use Calmly Premium until then. Back to your inbox`,
    elements: [{ id: 'e1', role: 'link', label: 'Back to your inbox' }] };
}
