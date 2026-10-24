// Mo Guard: is this link (or page) phishing?
// Layer 1, instant and free: signals from the address itself, the link text, the domain's
// age and a public phishing feed. Layer 2, only for links that look risky: a short call
// to Claude through Mubit (the link-check task), whose answers Mubit trains an adapter on.
// Only the link, its text and the page's host are ever sent: never page content.

import fs from 'node:fs';
import path from 'node:path';
import { BRANDS, WEAK_BRAND_KEYS, REDIRECTORS, SHORTENERS, FREE_HOSTS, RISKY_TLDS, MULTI_SUFFIXES, LOGIN_WORDS } from './guard-data.js';

export const BRANDS_FOR_SEED = BRANDS;
export const MODEL_THRESHOLD = 25;   // score at which a link is worth asking Claude about
const SUSPICIOUS_AT = 35;
const PHISHING_AT = 70;
const NEW_DOMAIN_DAYS = 60;
const FEED_URL = 'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt';

const WEIGHTS = {
  known_phishing: 100, lookalike_domain: 60, brand_in_domain: 45, text_mismatch: 45, punycode: 40, ip_address: 40,
  at_symbol: 35, new_domain: 30, password_form: 15, free_hosting: 20, risky_tld: 20, many_subdomains: 15, shortener: 15,
  login_words: 10, no_https: 10, long_url: 5,
};

// What each signal means, for labels and the warning screen.
export const SIGNAL_TEXT = {
  known_phishing: 'It is on a public list of reported phishing links',
  lookalike_domain: 'The address looks like {brand} but is spelled differently',
  brand_in_domain: 'It uses the name {brand} on a domain that isn\'t {brand}\'s',
  text_mismatch: 'The link text shows one address but goes to another',
  punycode: 'The address uses look-alike foreign characters',
  ip_address: 'It goes to a bare number address instead of a site name',
  at_symbol: 'The address hides its real destination after an @',
  new_domain: 'The site was registered only days ago',
  password_form: 'It asks for a password',
  free_hosting: 'It is on a free website builder anyone can use',
  risky_tld: 'It uses a domain ending that phishing sites favour',
  many_subdomains: 'The address is padded with many sub-parts',
  shortener: 'A link shortener hides where it goes',
  login_words: 'The address is full of words like login, verify or secure',
  no_https: 'The connection is not encrypted',
  long_url: 'The address is unusually long',
};

function dataDir() {
  const dir = process.env.SHOWME_DATA_DIR || path.resolve(import.meta.dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), file), 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => fs.writeFileSync(path.join(dataDir(), file), JSON.stringify(value, null, 2));

// ---- addresses ------------------------------------------------------------------

export function registrableDomain(host) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.');
  // Local test sites: "paypal-login.localhost" stands for a domain of its own.
  if (parts.at(-1) === 'localhost') return parts.length > 1 ? parts.slice(-2).join('.') : host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_SUFFIXES.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

const label = domain => domain.split('.')[0];
const fold = s => s.toLowerCase().replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/[1|]/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/[-_]/g, '');

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

export function brandFor(domain) {
  return BRANDS.find(b => b.domains.includes(domain)) || null;
}

// Does this domain imitate a brand? Returns { brand, kind } or null.
export function imitation(host) {
  const domain = registrableDomain(host);
  if (brandFor(domain)) return null; // it IS the brand
  const own = fold(label(domain));
  for (const brand of BRANDS) {
    for (const real of brand.domains) {
      const target = fold(label(real));
      if (target.length < 4) continue;
      const raw = label(domain);
      if (own === target && raw !== label(real)) return { brand, real, kind: 'lookalike_domain' };
      const limit = target.length >= 8 ? 2 : 1;
      if (own !== target && target.length >= 5 && editDistance(own, target) <= limit) return { brand, real, kind: 'lookalike_domain' };
    }
  }
  // Brand name used as a word somewhere in the host: paypal.com.secure-login.xyz, netflix-billing.top
  const words = host.toLowerCase().split(/[.\-_]+/);
  for (const brand of BRANDS) {
    if (WEAK_BRAND_KEYS.has(brand.key) || brand.key.length < 4) continue;
    if (words.includes(brand.key) || fold(host).includes(brand.key + 'com') || words.some(w => w.length > brand.key.length && w.startsWith(brand.key) && fold(w).length < brand.key.length + 8)) {
      return { brand, real: brand.domains[0], kind: 'brand_in_domain' };
    }
  }
  return null;
}

const looksLikeAddress = text => /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(String(text || '').trim());

// Layer 1 for one link.
export function signals({ url, text = '', pageHost = '', hasPassword = false, ageDays = null, feed = null }) {
  let u;
  try { u = new URL(url); } catch { return { ok: false }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false };
  const host = u.hostname.toLowerCase();
  const domain = registrableDomain(host);
  const found = new Set();
  let pretendsTo = null;

  if (feed?.has(url) || feed?.has(url.replace(/\/$/, '')) || feed?.hasHost(host)) found.add('known_phishing');
  const imitating = imitation(host);
  if (imitating) { found.add(imitating.kind); pretendsTo = imitating.real; }
  if (looksLikeAddress(text)) {
    const shown = registrableDomain(new URL(/^https?:/i.test(text.trim()) ? text.trim() : `https://${text.trim()}`).hostname);
    if (shown !== domain && !SHORTENERS.has(domain) && !REDIRECTORS.has(domain)) {
      found.add('text_mismatch');
      if (!pretendsTo && brandFor(shown)) pretendsTo = shown;
    }
  }
  if (host.includes('xn--')) found.add('punycode');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) found.add('ip_address');
  if (u.username || url.split('?')[0].includes('@')) found.add('at_symbol');
  if (ageDays !== null && ageDays < NEW_DOMAIN_DAYS) found.add('new_domain');
  if (hasPassword) found.add('password_form');
  if (FREE_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) found.add('free_hosting');
  if (RISKY_TLDS.has(host.split('.').at(-1))) found.add('risky_tld');
  if (host.split('.').length - domain.split('.').length >= 3) found.add('many_subdomains');
  if (SHORTENERS.has(domain)) found.add('shortener');
  if (LOGIN_WORDS.test(host + u.pathname)) found.add('login_words');
  if (u.protocol === 'http:' && !/(^|\.)localhost$/.test(host) && host !== '127.0.0.1') found.add('no_https');
  if (url.length > 120) found.add('long_url');

  const trusted = !!brandFor(domain) || domain === registrableDomain(pageHost) && !found.has('known_phishing');
  let score = [...found].reduce((sum, s) => sum + (WEIGHTS[s] || 0), 0);
  // Weak signals alone (an http link, a long address) are everyday noise, not phishing.
  if (!['known_phishing', 'lookalike_domain', 'brand_in_domain', 'text_mismatch', 'punycode', 'ip_address', 'at_symbol', 'new_domain', 'free_hosting'].some(s => found.has(s))) score = Math.min(score, 20);
  if (trusted && !found.has('known_phishing')) score = 0;
  return { ok: true, url, host, domain, signals: [...found], score: Math.min(100, score), pretendsTo, trusted, ageDays };
}

export function localVerdict(score) {
  return score >= PHISHING_AT ? 'phishing' : score >= SUSPICIOUS_AT ? 'suspicious' : 'safe';
}

// ---- domain age (RDAP, cached) -----------------------------------------------------

// rdap.org turns away requests that don't say who they are.
const RDAP_HEADERS = { accept: 'application/rdap+json', 'user-agent': 'ShowMe-MoGuard/0.5 (+https://github.com/faveh/MemStack)' };
const ageCache = new Map(Object.entries(readJson('guard-ages.json', {})));
let ageSaveTimer = null;

export async function domainAgeDays(domain) {
  if (!domain || domain.endsWith('localhost') || /^\d/.test(domain) || process.env.SHOWME_MOCK === '1') return null;
  const cached = ageCache.get(domain);
  if (cached && Date.now() - cached.at < 7 * 864e5) return cached.created ? Math.floor((Date.now() - Date.parse(cached.created)) / 864e5) : null;
  let created = null;
  // .com/.net ask the registry directly (fast); everything else goes through rdap.org.
  const tld = domain.split('.').at(-1);
  const urls = [...(tld === 'com' || tld === 'net' ? [`https://rdap.verisign.com/${tld}/v1/domain/${encodeURIComponent(domain)}`] : []), `https://rdap.org/domain/${encodeURIComponent(domain)}`];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500), headers: RDAP_HEADERS });
      if (!res.ok) continue;
      created = (await res.json()).events?.find(e => e.eventAction === 'registration')?.eventDate || null;
      if (created) break;
    } catch { /* try the next, or leave the age unknown */ }
  }
  ageCache.set(domain, { created, at: Date.now() });
  clearTimeout(ageSaveTimer);
  ageSaveTimer = setTimeout(() => writeJson('guard-ages.json', Object.fromEntries(ageCache)), 1000);
  return created ? Math.floor((Date.now() - Date.parse(created)) / 864e5) : null;
}

// ---- public phishing feed (OpenPhish community feed) -----------------------------------

const feed = { urls: new Set(), hosts: new Set(), loadedAt: 0, has(u) { return this.urls.has(u); }, hasHost(h) { return this.hosts.has(h); } };

export async function loadFeed() {
  if (process.env.SHOWME_MOCK === '1' || Date.now() - feed.loadedAt < 6 * 3600e3) return feed;
  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const lines = (await res.text()).split('\n').map(l => l.trim()).filter(l => /^https?:\/\//.test(l));
      feed.urls = new Set(lines.flatMap(l => [l, l.replace(/\/$/, '')]));
      feed.hosts = new Set(lines.map(l => { try { return new URL(l).hostname.toLowerCase(); } catch { return ''; } }).filter(Boolean));
      feed.loadedAt = Date.now();
    }
  } catch { /* keep the last copy */ }
  return feed;
}
export const feedSize = () => feed.urls.size ? feed.hosts.size : 0;

// ---- what people told Mo -------------------------------------------------------------

export const memory = {
  get: host => readJson('guard-memory.json', {})[host] || null,
  set(host, verdict) {
    const all = readJson('guard-memory.json', {});
    all[host] = verdict;
    writeJson('guard-memory.json', all);
  },
  all: () => readJson('guard-memory.json', {}),
};

// The user message for the link-check task. Everything that varies goes here.
export function linkMessage(s, { text = '', pageHost = '', reviewed = null }) {
  const lines = [
    `Link: ${s.url}`,
    `Link text: ${text ? text.slice(0, 120) : 'none'}`,
    `Found on: ${pageHost || 'unknown'}`,
    `Domain: ${s.domain} (${s.ageDays === null || s.ageDays === undefined ? 'registration date unknown' : `registered ${s.ageDays} days ago`})`,
    `Signals: ${s.signals.length ? s.signals.map(x => (x === 'lookalike_domain' || x === 'brand_in_domain') && s.pretendsTo ? `${x}(${s.pretendsTo})` : x).join(', ') : 'none'}`,
  ];
  if (reviewed) lines.push(`A human reviewed this link and says it is ${reviewed}.`);
  lines.push('', 'Answer with one JSON object only.');
  return lines.join('\n');
}

// How Claude did on links with known answers (written by scripts/seed-guard.js).
export const evalResults = () => readJson('guard-eval.json', null);
export const saveEval = value => writeJson('guard-eval.json', value);

export function explain(sig, pretendsTo) {
  const brand = pretendsTo ? (brandFor(pretendsTo)?.name || pretendsTo) : 'a known site';
  return sig.map(s => (SIGNAL_TEXT[s] || s).replaceAll('{brand}', brand));
}
