// Seeds Mo Guard's link-check task through Mubit with links whose answers are known:
// live phishing links from the OpenPhish community feed, and real links, including
// tricky real ones (email tracking redirects, project pages on free hosts, accented
// domains) so the adapter learns not to cry wolf. Only the addresses are sent; no page
// is ever opened. Claude's answers are scored against the known answers and saved for
// the Mubit tab and the judges.
//
//   npm run seed:guard                 # 120 phishing + 120 real
//   npm run seed:guard -- --count 40   # 40 + 40
//   npm run seed:guard -- --dry-run    # show a few messages, send nothing

import { loadEnv } from '../server/env.js';
import { TASKS } from '../server/prompts.js';

loadEnv();
const { callTask, getConfig } = await import('../server/llm.js');
const { signals, domainAgeDays, loadFeed, linkMessage, saveEval, BRANDS_FOR_SEED } = await import('../server/guard.js');

const args = process.argv.slice(2);
const COUNT = Number(args[args.indexOf('--count') + 1]) || 120;
const dryRun = args.includes('--dry-run');
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

const PATHS = ['/', '/signin', '/login', '/account', '/help', '/security', '/myaccount/summary', '/orders', '/settings/billing', '/support/contact'];
const PAGES = ['mail.google.com', 'www.bbc.co.uk', 'en.wikipedia.org', 'www.reddit.com', 'slack.com', 'web.whatsapp.com', 'outlook.live.com', 'news.ycombinator.com'];

// Real links, including the kinds that look a bit odd but are fine.
function realLinks(n) {
  const out = [];
  const brandDomains = BRANDS_FOR_SEED.flatMap(b => b.domains);
  const tricky = [
    () => ({ url: `https://links.mailchimp.com/ss/c/${Math.random().toString(36).slice(2)}`, text: 'www.bbc.co.uk' }),
    () => ({ url: `https://email.mg.stripe.com/c/${Math.random().toString(36).slice(2, 12)}`, text: 'View your receipt' }),
    () => ({ url: `https://${pick(['sindresorhus', 'vercel', 'tailwindlabs', 'mozilla', 'facebook'])}.github.io/${pick(['docs', 'awesome', 'blog', ''])}`, text: '' }),
    () => ({ url: `https://${pick(['my-portfolio', 'recipes-app', 'weather-demo', 'todo-mvc'])}-${Math.floor(Math.random() * 999)}.netlify.app/`, text: '' }),
    () => ({ url: `https://${pick(['nextjs-blog', 'shop-demo', 'ai-notes'])}.vercel.app/`, text: '' }),
    () => ({ url: 'https://xn--mnchen-3ya.de/', text: 'münchen.de' }),
    () => ({ url: 'http://192.168.1.1/', text: 'Router settings' }),
    () => ({ url: `https://bit.ly/${Math.random().toString(36).slice(2, 8)}`, text: 'Event photos' }),
    () => ({ url: `https://t.co/${Math.random().toString(36).slice(2, 12)}`, text: '' }),
    () => ({ url: `https://www.${pick(['theguardian.com', 'nytimes.com', 'ft.com', 'nature.com'])}/${pick(['world', 'science', 'technology'])}/2026/oct/${Math.floor(Math.random() * 28) + 1}/story`, text: '' }),
  ];
  for (let i = 0; i < n; i++) {
    out.push(Math.random() < 0.45 ? pick(tricky)() : { url: `https://${pick(['', 'www.'])}${pick(brandDomains)}${pick(PATHS)}`, text: pick(['', 'Sign in', 'Your account', 'Help centre']) });
  }
  return out;
}

const feed = await loadFeed();
// The feed keeps each address with and without a trailing slash: count each once.
const phishing = shuffle([...new Set([...feed.urls].map(u => u.replace(/\/$/, '')))]).slice(0, COUNT);
if (!phishing.length) { console.error('Could not load the OpenPhish feed. Check your internet connection.'); process.exit(1); }
const samples = shuffle([
  ...phishing.map(url => ({ url, text: Math.random() < 0.3 ? pick(['Verify your account', 'Sign in', 'Click here', 'Update payment']) : '', truth: 'phishing' })),
  ...realLinks(COUNT).map(l => ({ ...l, truth: 'safe' })),
]);

const config = getConfig();
async function prepare(sample) {
  const pageHost = pick(PAGES);
  let s = signals({ url: sample.url, text: sample.text, pageHost, feed: null }); // the feed itself is the answer key, so leave it out
  if (!s.ok) return null;
  s = signals({ url: sample.url, text: sample.text, pageHost, feed: null, ageDays: await domainAgeDays(s.domain) });
  return { ...sample, s, pageHost };
}

if (dryRun) {
  for (const sample of samples.slice(0, 4)) { const p = await prepare(sample); if (p) console.log(`[${p.truth}]\n${linkMessage(p.s, p)}\n`); }
  process.exit(0);
}
if (config.provider === 'mock') { console.error('No MUBIT_API_KEY in .env, so there is nothing to seed.'); process.exit(1); }

console.log(`Seeding link-check through Mubit on ${config.provider} / ${config.model}: ${phishing.length} phishing + ${COUNT} real links (addresses only)`);
const tally = { n: 0, phishing: 0, legit: 0, caught: 0, falseAlarms: 0, blockingFalseAlarms: 0, correct: 0, failed: 0 };
const mistakes = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < samples.length) {
    const sample = samples[next++];
    const p = await prepare(sample);
    if (!p) continue;
    try {
      const r = await callTask({ task: TASKS.linkCheck, userMessage: linkMessage(p.s, p), sessionId: `guard-seed-${Date.now()}-${next}`, kind: 'live',
        summarize: j => `${j.verdict}: ${p.s.host} (known: ${p.truth})` });
      const flagged = r.json.verdict === 'phishing' || r.json.verdict === 'suspicious';
      tally.n++;
      if (p.truth === 'phishing') { tally.phishing++; if (flagged) { tally.caught++; tally.correct++; } }
      else { tally.legit++; if (flagged) tally.falseAlarms++; else tally.correct++; if (r.json.verdict === 'phishing') tally.blockingFalseAlarms++; }
      if (flagged !== (p.truth === 'phishing')) mistakes.push({ host: p.s.host, truth: p.truth, verdict: r.json.verdict, signals: p.s.signals });
    } catch (err) {
      tally.failed++;
      if (/401|403|starter_credit/.test(err.message)) throw err;
    }
    if ((tally.n + tally.failed) % 20 === 0) console.log(`  ${tally.n + tally.failed}/${samples.length}`);
  }
}));

const claude = { ...tally, accuracy: tally.n ? tally.correct / tally.n : 0, model: config.model, at: new Date().toISOString() };
saveEval({ claude, mistakes: mistakes.slice(0, 60) });
console.log(`Done: ${tally.n} checked, ${tally.failed} failed.`);
console.log(`Claude was right on ${Math.round(100 * claude.accuracy)}%: caught ${tally.caught}/${tally.phishing} phishing links; on ${tally.legit} real ones, ${tally.blockingFalseAlarms} called phishing and ${tally.falseAlarms - tally.blockingFalseAlarms} marked suspicious.`);
const byKind = {};
for (const m of mistakes) { const k = `${m.truth}→${m.verdict}: ${m.signals.join('+') || 'no signals'}`; byKind[k] = (byKind[k] || 0) + 1; }
console.log('Mistakes by kind:', Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${n}× ${k}`).join(' | '));
console.log('Open Mubit → Tasks to watch "link-check" count towards 25.');
