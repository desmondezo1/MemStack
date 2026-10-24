// Mo Guard on the page: checks this page and the links on it for phishing, labels the
// risky ones like a game ("🚩 Pretends to be PayPal"), lets Mo react, stops clicks on
// phishing links, and covers a phishing page with a full-screen warning. Only link
// addresses, their text and this page's address are sent to the backend for checking.

(() => {
  if (window.top !== window || !/^https?:$/.test(location.protocol)) return;
  const previous = window.__showMeGuard;
  if (previous?.alive?.()) return;
  previous?.dispose?.();
  document.querySelectorAll('showme-guard').forEach(el => el.remove());

  const host = document.createElement('showme-guard');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483645; font: 600 12px/1.3 system-ui, -apple-system, sans-serif; }
  .tag { position: absolute; pointer-events: auto; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px 3px 6px;
    border-radius: 999px; color: #fff; background: #c33a2c; box-shadow: 0 4px 14px rgba(0,0,0,.22); white-space: nowrap; transform-origin: left center;
    animation: pop 420ms cubic-bezier(.2,1.6,.4,1) both; }
  .tag.suspicious { background: #b8620d; }
  .tag:focus-visible { outline: 3px solid #5b4cf5; outline-offset: 2px; }
  @keyframes pop { from { transform: scale(.2) rotate(-8deg); opacity: 0; } }
  .pop { position: absolute; pointer-events: auto; width: 270px; background: #fff; color: #16181d; border-radius: 14px; padding: 12px 14px;
    box-shadow: 0 16px 40px rgba(18,22,33,.24); font-weight: 400; font-size: 13px; }
  .pop h4 { margin: 0 0 6px; font-size: 14px; }
  .pop ul { margin: 0 0 10px; padding-left: 18px; color: #5d636f; }
  .pop li { margin: 2px 0; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  button { font: 600 13px system-ui, sans-serif; border: 0; border-radius: 10px; padding: 8px 12px; cursor: pointer; }
  .primary { background: #f05a1e; color: #fff; }
  .quiet { background: #f0f1f4; color: #16181d; }
  .link { background: none; color: #5d636f; padding: 8px 4px; text-decoration: underline; }
  .wall { position: fixed; inset: 0; pointer-events: auto; z-index: 2147483647; display: grid; place-items: center; padding: 24px;
    background: rgba(28, 8, 4, .78); backdrop-filter: blur(6px); animation: fade 260ms ease both; }
  @keyframes fade { from { opacity: 0; } }
  .card { width: min(520px, 100%); background: #fff; color: #16181d; border-radius: 22px; padding: 28px 28px 22px; box-shadow: 0 30px 80px rgba(0,0,0,.35);
    font: 400 15px/1.5 system-ui, -apple-system, sans-serif; animation: rise 360ms cubic-bezier(.2,.9,.3,1.1) both; }
  @keyframes rise { from { transform: translateY(18px) scale(.97); opacity: 0; } }
  .card .mo { width: 76px; height: 76px; margin-bottom: 10px; animation: wobble 2.4s ease-in-out infinite; transform-origin: 50% 90%; }
  @keyframes wobble { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
  .card h2 { margin: 0 0 6px; font-size: 22px; letter-spacing: -0.01em; }
  .card .sub { margin: 0 0 14px; color: #5d636f; }
  .card .sub b { color: #16181d; }
  .card ul { margin: 0 0 20px; padding-left: 20px; color: #3b3f48; }
  .card .row { gap: 10px; }
  .card .primary { padding: 11px 16px; font-size: 14px; }
  .card .quiet { padding: 11px 16px; font-size: 14px; }
  @media (prefers-color-scheme: dark) {
    .pop, .card { background: #202227; color: #eef0f4; } .pop ul, .card .sub { color: #a2a7b2; } .card ul { color: #c9ccd3; }
    .card .sub b { color: #eef0f4; } .quiet { background: #2e3037; color: #eef0f4; }
  }
  @media (prefers-reduced-motion: reduce) { .tag, .wall, .card, .card .mo { animation: none !important; } }
</style>
<div class="layer"></div>`;
  const layer = root.querySelector('.layer');
  document.documentElement.appendChild(host);

  const MO_SVG = `<svg class="mo" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="g" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffb894"/><stop offset=".55" stop-color="#ff6a2b"/><stop offset="1" stop-color="#e0440e"/></radialGradient></defs>
    <circle cx="32" cy="31" r="24" fill="url(#g)"/><ellipse cx="23" cy="19" rx="6" ry="4" fill="#fff" opacity=".35"/>
    <path d="M18 22 L28 25" stroke="#7a2306" stroke-width="2.4" stroke-linecap="round"/><path d="M46 22 L36 25" stroke="#7a2306" stroke-width="2.4" stroke-linecap="round"/>
    <ellipse cx="24" cy="32" rx="4.4" ry="5" fill="#fff"/><ellipse cx="40" cy="32" rx="4.4" ry="5" fill="#fff"/><circle cx="26" cy="33" r="2.5" fill="#1d1d1f"/><circle cx="42" cy="33" r="2.5" fill="#1d1d1f"/>
    <path d="M26 44 Q32 40 38 44" stroke="#7a2306" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`;

  let enabled = true;
  const results = new Map();   // url → result
  const asked = new Set();     // urls already sent for checking
  const tags = new Map();      // anchor element → { tag, result }
  let wallOpen = false;
  let moTold = false;

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const report = () => { host.dataset.flags = String([...tags.values()].length); }; // for tests

  // ---- finding links -------------------------------------------------------------

  function linkText(a) {
    return (a.innerText || a.getAttribute('aria-label') || a.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function nearViewport(a) {
    const r = a.getBoundingClientRect();
    return (r.width || r.height) && r.bottom > -600 && r.top < innerHeight + 900;
  }

  function candidates(limit = 60) {
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      if (out.length >= limit) break;
      const url = a.href;
      if (!/^https?:/i.test(url) || url.split('#')[0] === location.href.split('#')[0] || asked.has(url)) continue;
      if (!nearViewport(a)) continue;
      out.push({ url, text: linkText(a) });
      asked.add(url);
    }
    return out;
  }

  async function check(links, { includePage = false } = {}) {
    if (!enabled || (!links.length && !includePage)) return;
    const reply = await chrome.runtime.sendMessage({
      type: 'guard:check', pageUrl: location.href, links, hasPassword: !!document.querySelector('input[type=password]'),
    }).catch(() => null);
    if (!reply?.ok) return;
    const fresh = [];
    for (const r of reply.results) {
      if (r.kind === 'page') { pageResult(r); continue; }
      results.set(r.url, r);
      if (r.verdict !== 'safe') fresh.push(r);
    }
    if (fresh.length) reveal(fresh);
  }

  // ---- labels on risky links -------------------------------------------------------

  function anchorsFor(url) { return [...document.querySelectorAll('a[href]')].filter(a => a.href === url); }

  // Mo thinks first, then the labels pop in one by one, like a game.
  function reveal(found) {
    const first = anchorsFor(found[0].url)[0];
    const box = first?.getBoundingClientRect();
    mo('thinking', { text: 'Hmm…', hold: 1200 });
    setTimeout(() => {
      found.forEach((r, i) => setTimeout(() => anchorsFor(r.url).forEach(a => tag(a, r)), i * 260));
      const phishing = found.find(r => r.verdict === 'phishing');
      const lead = phishing || found[0];
      const text = lead.brand
        ? `Hmm… I think this link is pretending to be ${lead.brand}. Careful!`
        : 'Hmm… I think this link looks suspicious 🤔';
      mo('suspicious', { text: moTold ? '' : text, x: box ? box.left + box.width / 2 : null, y: box ? box.top + box.height / 2 : null });
      moTold = true;
    }, 1100);
  }

  function tag(a, r) {
    if (tags.has(a)) return;
    const t = document.createElement('button');
    t.className = `tag ${r.verdict}`;
    t.textContent = r.verdict === 'phishing'
      ? (r.brand ? `⛔ Fake ${r.brand}?` : '⛔ Looks like phishing')
      : (r.brand ? `🚩 Pretends to be ${r.brand}?` : '🚩 Suspicious link');
    t.setAttribute('aria-label', `${t.textContent} Show why`);
    t.addEventListener('click', e => { e.stopPropagation(); explainTag(a, r); });
    layer.appendChild(t);
    const prevOutline = a.style.outline;
    a.style.outline = `2px dashed ${r.verdict === 'phishing' ? '#c33a2c' : '#b8620d'}`;
    a.style.outlineOffset = '2px';
    tags.set(a, { tag: t, result: r, prevOutline });
    place();
    report();
  }

  function untag(a) {
    const entry = tags.get(a);
    if (!entry) return;
    entry.tag.remove();
    a.style.outline = entry.prevOutline;
    tags.delete(a);
    report();
  }

  let placing = false;
  function place() {
    if (placing) return;
    placing = true;
    requestAnimationFrame(() => {
      placing = false;
      for (const [a, { tag: t }] of tags) {
        const r = a.getBoundingClientRect();
        const hidden = !a.isConnected || (!r.width && !r.height) || r.bottom < 0 || r.top > innerHeight;
        t.style.display = hidden ? 'none' : '';
        t.style.left = `${Math.min(innerWidth - 220, Math.max(4, r.right + 6))}px`;
        t.style.top = `${Math.max(4, r.top + r.height / 2 - 11)}px`;
      }
      const pop = layer.querySelector('.pop');
      if (pop?.anchor) {
        const r = pop.anchor.getBoundingClientRect();
        pop.style.left = `${Math.min(innerWidth - 290, Math.max(8, r.left))}px`;
        pop.style.top = `${r.bottom + 10 + 230 > innerHeight ? Math.max(8, r.top - 240) : r.bottom + 10}px`;
      }
    });
  }

  function explainTag(a, r) {
    layer.querySelector('.pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.anchor = a;
    pop.innerHTML = `<h4>${r.verdict === 'phishing' ? 'This link looks like phishing' : 'This link looks suspicious'}</h4>
      <ul>${r.reasons.slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="row"><button class="quiet" data-v="safe">It's fine</button><button class="primary" data-v="phishing">Yes, it's phishing</button></div>`;
    pop.addEventListener('click', e => {
      const verdict = e.target.closest('button')?.dataset.v;
      if (!verdict) return;
      feedback(r.url, verdict, linkText(a));
      pop.remove();
      delete host.dataset.pop;
      if (verdict === 'safe') { anchorsFor(r.url).forEach(untag); mo('success', { text: 'Got it, I\'ll remember that one. Thanks!', hold: 2500 }); }
      else { r.verdict = 'phishing'; mo('learning', { count: 1, text: 'Thanks! I\'ll learn from that.' }); }
    });
    layer.appendChild(pop);
    host.dataset.pop = 'open'; // for tests
    pop.querySelector('button').focus();
    place();
  }

  function feedback(url, verdict, text = '') {
    chrome.runtime.sendMessage({ type: 'guard:feedback', url, verdict, text, pageUrl: location.href }).catch(() => {});
  }

  // ---- stopping clicks on phishing links -------------------------------------------

  function onClick(e) {
    if (!enabled || wallOpen || e.defaultPrevented || e.button !== 0) return;
    const a = e.target.closest?.('a[href]');
    const r = a && results.get(a.href);
    if (!r || r.verdict !== 'phishing') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    wall(r, 'link', a);
  }

  // ---- the full-screen warning --------------------------------------------------------

  function pageResult(r) {
    host.dataset.page = r.verdict; // for tests
    if (r.verdict === 'phishing' || (r.verdict === 'suspicious' && r.brand && document.querySelector('input[type=password]'))) wall(r, 'page');
  }

  function wall(r, kind, anchor = null) {
    if (wallOpen) return;
    wallOpen = true;
    host.dataset.wall = kind; // for tests
    const brand = r.brand;
    const div = document.createElement('div');
    div.className = 'wall';
    div.setAttribute('role', 'alertdialog');
    div.setAttribute('aria-modal', 'true');
    div.setAttribute('aria-labelledby', 'mo-guard-title');
    const title = kind === 'page'
      ? (brand ? `Hmm… this looks like a fake ${esc(brand)} page` : 'Hmm… this page looks like phishing')
      : (brand ? `Hmm… that link pretends to be ${esc(brand)}` : 'Hmm… that link looks like a trap');
    const where = kind === 'page' ? `You're on <b>${esc(r.host)}</b>` : `It goes to <b>${esc(r.host)}</b>`;
    const real = r.realSite ? `, not ${esc(r.pretendsTo)}` : '';
    div.innerHTML = `<div class="card">${MO_SVG}
      <h2 id="mo-guard-title">${title}</h2>
      <p class="sub">${where}${real}. Don't type passwords or card details here.</p>
      <ul>${r.reasons.slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="row">
        ${r.realSite ? `<button class="primary" data-act="real">Take me to the real ${esc(brand || r.pretendsTo)}</button>` : ''}
        <button class="${r.realSite ? 'quiet' : 'primary'}" data-act="back">${kind === 'page' ? 'Get me out of here' : 'Stay here'}</button>
        <button class="link" data-act="trust">${kind === 'page' ? 'I trust this site' : 'Open it anyway'}</button>
      </div></div>`;
    div.addEventListener('click', e => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      if (act === 'real') { location.href = r.realSite; return; }
      if (act === 'back') {
        if (kind === 'page') { history.length > 1 ? history.back() : (location.href = 'about:blank'); }
        close();
        return;
      }
      // Trusting it is a correction: remembered, and sent to Mubit as a training example.
      feedback(kind === 'page' ? location.href : r.url, 'safe', anchor ? linkText(anchor) : '');
      close();
      if (kind === 'link') location.href = r.url;
      else mo('success', { text: 'Okay! I\'ll remember this site is fine.', hold: 2500 });
    });
    function close() { div.remove(); wallOpen = false; delete host.dataset.wall; }
    layer.appendChild(div);
    div.querySelector('button')?.focus();
    mo('suspicious', { text: '', x: innerWidth / 2, y: innerHeight / 2 });
  }

  // ---- Mo -------------------------------------------------------------------------------

  function mo(state, extra = {}) {
    chrome.runtime.sendMessage({ type: 'guard:mo', state, ...extra }).catch(() => {});
  }

  // ---- lifecycle --------------------------------------------------------------------------

  let scanTimer = null;
  const scanSoon = (ms = 1200) => { clearTimeout(scanTimer); scanTimer = setTimeout(() => check(candidates()), ms); };
  const onScroll = () => { place(); scanSoon(900); };
  const onOver = e => {
    const a = e.target.closest?.('a[href]');
    if (a && /^https?:/i.test(a.href) && !asked.has(a.href)) { asked.add(a.href); check([{ url: a.href, text: linkText(a) }]); }
  };
  const observer = new MutationObserver(() => { scanSoon(1500); place(); });

  function onMessage(msg, _sender, reply) {
    if (msg.type === 'guard:report-page') {
      feedback(location.href, 'phishing');
      mo('learning', { count: 1, text: 'Thanks for reporting it! I\'ll learn from that.' });
      reply({ ok: true });
    }
    return false;
  }

  function start() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerover', onOver, { passive: true, capture: true });
    addEventListener('scroll', onScroll, { passive: true, capture: true });
    addEventListener('resize', place);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    check(candidates(), { includePage: true });
  }

  function stop() {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('pointerover', onOver, { capture: true });
    removeEventListener('scroll', onScroll, { capture: true });
    removeEventListener('resize', place);
    observer.disconnect();
    clearTimeout(scanTimer);
    for (const a of [...tags.keys()]) untag(a);
    layer.innerHTML = '';
    wallOpen = false;
  }

  chrome.runtime.onMessage.addListener(onMessage);
  const onStorage = (changes, area) => {
    if (area !== 'local' || !changes.guardOn) return;
    enabled = changes.guardOn.newValue !== false;
    if (enabled) { asked.clear(); start(); } else stop();
  };
  chrome.storage.onChanged.addListener(onStorage);
  chrome.storage.local.get('guardOn').then(({ guardOn }) => { enabled = guardOn !== false; if (enabled) start(); }).catch(() => start());

  function dispose() {
    stop();
    clearInterval(heartbeat);
    try { chrome.runtime.onMessage.removeListener(onMessage); chrome.storage.onChanged.removeListener(onStorage); } catch { /* already dead */ }
    host.remove();
  }
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const heartbeat = setInterval(() => { if (!alive()) dispose(); }, 2000);
  window.__showMeGuard = { alive, dispose };
})();
