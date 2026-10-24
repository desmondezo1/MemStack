// Mo, Show Me's mascot, on every page: an animated SVG orb in a corner that shows what
// the agent is doing, plus the voice waveform while you talk. Lives in a closed Shadow
// DOM so the site's CSS can't touch it, and the agent's page reader can't see it.
// The side panel drives it with 'showme:mo' and 'showme:voice' messages.

(() => {
  if (window.top !== window) return;
  // After the extension is reloaded, the old copy in this page is dead (its chrome.runtime
  // is gone). Replace a dead copy; skip only if a live one is already here.
  const previous = window.__showMeMo;
  if (previous?.alive?.()) return;
  previous?.dispose?.();
  document.querySelectorAll('showme-mo').forEach(el => el.remove());

  const BARS = 20;
  const host = document.createElement('showme-mo');
  host.dataset.state = 'idle';
  const root = host.attachShadow({ mode: 'closed' });

  root.innerHTML = `
<style>
  :host { all: initial; }
  .wrap { position: fixed; z-index: 2147483646; width: 64px; height: 64px; font: 13px/1.35 system-ui, -apple-system, sans-serif;
    transition: transform 520ms cubic-bezier(.2,.8,.2,1), opacity 200ms; transform: translate(var(--wx, 0px), var(--wy, 0px)); }
  .wrap.br { right: 18px; bottom: 18px; } .wrap.bl { left: 18px; bottom: 18px; }
  .wrap.tr { right: 18px; top: 18px; }    .wrap.tl { left: 18px; top: 18px; }
  .wrap.hidden { opacity: 0; pointer-events: none; }
  .mo { all: unset; display: block; width: 64px; height: 64px; cursor: pointer; position: relative; touch-action: none; }
  .mo:focus-visible { outline: 3px solid #6d5efc; outline-offset: 2px; border-radius: 50%; }
  svg { overflow: visible; display: block; }
  .body { animation: bob 2.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
  .eye, .pupil { transform-box: fill-box; transform-origin: center; transition: transform 70ms ease-in; }
  .wrap.blink .eye, .wrap.blink .pupil { transform: scaleY(.08); }
  .pupil { transition: transform 70ms ease-in, cx 90ms ease-out, cy 90ms ease-out, r 200ms; }
  .shadow { fill: rgba(0,0,0,.18); animation: shadow 2.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .ring { fill: none; stroke: #6d5efc; stroke-width: 3; opacity: 0; transform-box: fill-box; transform-origin: center; }
  .dots { opacity: 0; } .dots circle { fill: #6d5efc; animation: dot 900ms ease-in-out infinite; }
  .dots circle:nth-child(2) { animation-delay: 150ms; } .dots circle:nth-child(3) { animation-delay: 300ms; }
  @keyframes bob { 50% { transform: translateY(-4px); } }
  @keyframes shadow { 50% { transform: scaleX(.8); opacity: .7; } }
  @keyframes dot { 50% { transform: translateY(-4px); } }
  @keyframes ring { from { opacity: .8; transform: scale(.85); } to { opacity: 0; transform: scale(1.35); } }
  @keyframes jump { 30% { transform: translateY(-18px) scale(1.05, .95); } 60% { transform: translateY(0) scale(1.08, .9); } }
  @keyframes tilt { 50% { transform: rotate(-14deg); } }

  .wrap[data-state=listening] .ring { animation: ring 1.1s ease-out infinite; }
  .wrap[data-state=thinking] .dots { opacity: 1; }
  .wrap[data-state=acting] .body { animation: none; transform: rotate(8deg); }
  .wrap[data-state=stuck] .body { animation: tilt 1.6s ease-in-out infinite; }
  .wrap[data-state=stuck] .mouth { d: path('M27 42 Q32 39 37 42'); }
  .wrap[data-state=success] .body { animation: jump 700ms ease-out 2; }
  .wrap[data-state=learning] .body { animation: bob 900ms ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .body, .shadow, .ring, .dots circle { animation: none !important; } .wrap { transition: none; } }

  .bubble, .pill { position: absolute; bottom: 72px; background: #fff; color: #1d1d1f; border-radius: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.18);
    padding: 8px 12px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
  .br .bubble, .br .pill, .tr .bubble, .tr .pill { right: 0; } .bl .bubble, .bl .pill, .tl .bubble, .tl .pill { left: 0; }
  .tr .bubble, .tl .bubble, .tr .pill, .tl .pill { bottom: auto; top: 72px; }
  .bubble[hidden], .pill[hidden], .menu[hidden] { display: none; }
  .bubble { white-space: normal; width: max-content; max-width: 260px; }
  .bubble.ask { border: 2px solid #ff5a1f; cursor: pointer; }
  .pill { display: flex; align-items: center; gap: 10px; background: #1d1d1f; color: #fff; padding: 8px 14px; }
  .bars { display: flex; align-items: center; gap: 2px; height: 26px; }
  .bars span { width: 3px; height: 4px; border-radius: 2px; background: #ff5a1f; transition: height 70ms linear; }
  .words { max-width: 200px; overflow: hidden; text-overflow: ellipsis; color: #e5e5ea; }
  .rec { width: 8px; height: 8px; border-radius: 50%; background: #ff3b30; animation: ring 1.2s infinite; }
  .card { position: fixed; z-index: 2147483647; background: #6d5efc; color: #fff; font: 600 12px system-ui; padding: 4px 8px; border-radius: 8px;
    pointer-events: none; transition: transform 900ms cubic-bezier(.3,.7,.3,1), opacity 900ms; }
  .more { all: unset; position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; background: #fff; color: #1d1d1f;
    font: 700 12px/20px system-ui; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,.2); opacity: 0; cursor: pointer; transition: opacity 150ms; }
  .wrap:hover .more, .more:focus-visible { opacity: 1; }
  .menu { position: absolute; bottom: 72px; right: 0; background: #fff; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 4px; min-width: 170px; }
  .bl .menu, .tl .menu { left: 0; right: auto; } .tr .menu, .tl .menu { top: 72px; bottom: auto; }
  .menu button { all: unset; display: block; width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 8px; color: #1d1d1f; cursor: pointer; }
  .menu button:hover, .menu button:focus-visible { background: #f2f2f7; }
  @media (prefers-color-scheme: dark) { .bubble, .menu { background: #2c2c30; color: #f2f2f7; } .menu button { color: #f2f2f7; } .menu button:hover { background: #3a3a40; } }
</style>
<div class="wrap br" data-state="idle">
  <div class="bubble" hidden></div>
  <div class="pill" hidden><span class="rec"></span><div class="bars">${'<span></span>'.repeat(BARS)}</div><span class="words">Listening…</span></div>
  <div class="menu" hidden role="menu">
    <button data-act="talk" role="menuitem">How to talk to me</button>
    <button data-act="panel" role="menuitem">Open the Show Me panel</button>
    <button data-act="hide" role="menuitem">Hide on this site</button>
  </div>
  <button class="mo" aria-label="Show Me: click to talk, drag to move">
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <defs>
        <radialGradient id="mo-g" cx="35%" cy="30%" r="75%">
          <stop offset="0" stop-color="#ffb894"/><stop offset=".55" stop-color="#ff6a2b"/><stop offset="1" stop-color="#e0440e"/>
        </radialGradient>
      </defs>
      <ellipse class="shadow" cx="32" cy="61" rx="15" ry="2.6"/>
      <circle class="ring" cx="32" cy="31" r="27"/>
      <g class="body">
        <circle cx="32" cy="31" r="24" fill="url(#mo-g)"/>
        <ellipse cx="23" cy="19" rx="6" ry="4" fill="#fff" opacity=".35"/>
        <ellipse class="eye" cx="24" cy="31" rx="4.4" ry="5.4" fill="#fff"/>
        <ellipse class="eye" cx="40" cy="31" rx="4.4" ry="5.4" fill="#fff"/>
        <circle class="pupil" cx="25" cy="32" r="2.5" fill="#1d1d1f"/>
        <circle class="pupil" cx="41" cy="32" r="2.5" fill="#1d1d1f"/>
        <path class="mouth" d="M27 41 Q32 45 37 41" stroke="#7a2306" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      </g>
      <g class="dots"><circle cx="24" cy="2" r="2.6"/><circle cx="32" cy="2" r="2.6"/><circle cx="40" cy="2" r="2.6"/></g>
    </svg>
  </button>
  <button class="more" aria-label="Mo menu">⋯</button>
</div>`;

  const wrap = root.querySelector('.wrap');
  const bubble = root.querySelector('.bubble');
  const pill = root.querySelector('.pill');
  const bars = [...root.querySelectorAll('.bars span')];
  const words = root.querySelector('.words');
  const menu = root.querySelector('.menu');
  const moButton = root.querySelector('.mo');
  let corner = 'br';
  let bubbleTimer = null;
  let stateTimer = null;
  let wanderTimer = null;
  let hiddenHere = false;
  let voiceSeenAt = 0;

  document.documentElement.appendChild(host);

  // ---- state ----------------------------------------------------------------

  function setState(state, { text = '', ask = false, hold = 0 } = {}) {
    clearTimeout(stateTimer);
    wrap.dataset.state = state;
    host.dataset.state = state;
    queueGaze();
    if (text) say(text, { ask, hold: hold || 4000 });
    if (state !== 'idle' && state !== 'listening' && state !== 'acting' && hold) {
      stateTimer = setTimeout(() => setState('idle'), hold);
    }
  }

  function say(text, { ask = false, hold = 4000 } = {}) {
    clearTimeout(bubbleTimer);
    bubble.textContent = text;
    bubble.classList.toggle('ask', ask);
    bubble.hidden = false;
    host.dataset.bubble = text;
    if (hold !== Infinity) bubbleTimer = setTimeout(hideBubble, hold);
  }

  function hideBubble() {
    bubble.hidden = true;
    delete host.dataset.bubble;
  }

  // Float next to the element the agent is about to use, then come back.
  let actingTarget = null;
  function actOn(targetId) {
    const el = targetId && document.querySelector(`[data-showme-id="${CSS.escape(targetId)}"]`);
    actingTarget = el || null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const home = wrap.getBoundingClientRect();
    const x = Math.max(8, Math.min(innerWidth - 72, r.right + 8)) - (home.left - getOffset('x'));
    const y = Math.max(8, Math.min(innerHeight - 72, r.top - 12)) - (home.top - getOffset('y'));
    wrap.style.setProperty('--wx', `${Math.round(x)}px`);
    wrap.style.setProperty('--wy', `${Math.round(y)}px`);
    setTimeout(goHome, 1100);
  }

  const getOffset = axis => parseFloat(wrap.style.getPropertyValue(axis === 'x' ? '--wx' : '--wy')) || 0;

  function goHome() {
    wrap.style.setProperty('--wx', '0px');
    wrap.style.setProperty('--wy', '0px');
  }

  // "+1 → Mubit" cards fly off toward the corner: each taught step becomes a training example.
  function flyCards(count) {
    const n = Math.min(count || 1, 8);
    const start = wrap.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const card = document.createElement('div');
      card.className = 'card';
      card.textContent = '+1 → Mubit';
      card.style.left = `${start.left}px`;
      card.style.top = `${start.top}px`;
      root.appendChild(card);
      setTimeout(() => {
        card.style.transform = `translate(${(corner.endsWith('r') ? -1 : 1) * (40 + Math.random() * 120)}px, ${-(80 + i * 26 + Math.random() * 40)}px)`;
        card.style.opacity = '0';
      }, 60 + i * 140);
      setTimeout(() => card.remove(), 1300 + i * 140);
    }
  }

  // Idle wandering: every so often Mo shuffles a little along its edge.
  function wander() {
    clearTimeout(wanderTimer);
    wanderTimer = setTimeout(() => {
      if (wrap.dataset.state === 'idle' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const dir = corner.endsWith('r') ? -1 : 1;
        wrap.style.setProperty('--wx', `${dir * Math.round(Math.random() * 46)}px`);
        setTimeout(() => { if (wrap.dataset.state === 'idle') goHome(); }, 2600);
      }
      wander();
    }, 7000 + Math.random() * 8000);
  }

  // ---- voice ----------------------------------------------------------------

  // Waveform updates arrive about 14 times a second while you talk. Updates can arrive
  // out of order, so a session that has ended never shows again, and the waveform
  // hides by itself if updates stop coming (a lost "stopped" message can't leave it up).
  const endedSessions = new Set();
  let voiceWatchdog = null;

  function hideWave() {
    clearTimeout(voiceWatchdog);
    pill.hidden = true;
    host.dataset.voice = 'off';
    if (wrap.dataset.state === 'listening') setState('idle');
  }

  let lastVoiceId = null;
  function voice({ state, id, levels = [], text = '' }) {
    // Late waveform updates from a session that has ended never bring it back.
    if (state === 'listening' && id && endedSessions.has(id)) return;
    voiceSeenAt = Date.now();
    if (state === 'listening') {
      lastVoiceId = id || lastVoiceId;
      host.dataset.voice = 'listening';
      setState('listening');
      hideBubble();
      pill.hidden = false;
      bars.forEach((b, i) => { b.style.height = `${4 + Math.round((levels[i] || 0) * 22)}px`; });
      words.textContent = text || 'Listening… let go to send, Esc to cancel';
      clearTimeout(voiceWatchdog);
      voiceWatchdog = setTimeout(hideWave, 900);
      return;
    }
    if (id) endedSessions.add(id);
    hideWave();
    host.dataset.voice = state;
    // (A cancel or a tap already got its message when the key or Mo was let go.)
    if (state === 'heard' && text) setState('thinking', { text: `“${text}”`, hold: 3000 });
  }

  // ---- interaction ------------------------------------------------------------

  // ---- push to talk: hold ⌥Space (or hold Mo), let go to send, Esc to cancel -----

  const TAP_MS = 250;
  let holding = null; // { at, via }

  function holdHint() { say('Hold ⌥ Space (or hold me) while you talk, then let go.', { hold: 4000 }); }

  function startHold(via) {
    if (holding) return;
    holding = { at: Date.now(), via };
    host.dataset.holding = via;
    setState('listening');
    pill.hidden = false;
    words.textContent = 'Listening… let go to send, Esc to cancel';
    clearTimeout(voiceWatchdog);
    voiceWatchdog = setTimeout(() => { if (holding && voiceSeenAt < holding.at) say('Still waking up the microphone…', { hold: 2000 }); }, 1500);
    chrome.runtime.sendMessage({ type: 'showme:voice-start' }).catch(() => {});
  }

  function endHold(kind) {
    if (!holding) return;
    const quick = Date.now() - holding.at < TAP_MS;
    holding = null;
    if (lastVoiceId) endedSessions.add(lastVoiceId); // you let go: no more waveform for this session
    delete host.dataset.holding;
    if (kind === 'stop' && quick) kind = 'tap';
    chrome.runtime.sendMessage({ type: kind === 'stop' ? 'showme:voice-stop' : 'showme:voice-cancel' }).catch(() => {});
    if (kind !== 'stop') hideWave();
    else { clearTimeout(voiceWatchdog); voiceWatchdog = setTimeout(hideWave, 3000); } // never left showing
    if (kind === 'tap') holdHint();
    if (kind === 'cancel') say('Cancelled.', { hold: 1500 });
  }

  const isTalkCombo = e => e.code === 'Space' && e.altKey && !e.ctrlKey && !e.metaKey;
  function onKeyDown(e) {
    if (isTalkCombo(e)) {
      e.preventDefault(); // ⌥Space would otherwise type a space
      if (!e.repeat) startHold('keys');
    } else if (e.key === 'Escape' && holding) {
      e.preventDefault();
      endHold('cancel');
    }
  }
  function onKeyUp(e) {
    if (holding?.via === 'keys' && (e.code === 'Space' || e.key === 'Alt')) { e.preventDefault(); endHold('stop'); }
  }
  // Switching away mid-hold means we'll never see the key come up: cancel.
  const onBlur = () => { if (holding) endHold('cancel'); };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);

  let drag = null;
  moButton.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    moButton.setPointerCapture(e.pointerId);
    // Holding Mo still for a moment starts listening; moving first means a drag.
    drag.timer = setTimeout(() => { if (drag && !drag.moved) startHold('mo'); }, TAP_MS);
  });
  moButton.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (holding?.via === 'mo') {
      // Slide away to cancel, like a voice note.
      if (Math.hypot(dx, dy) > 80) { endHold('cancel'); clearTimeout(drag.timer); drag = null; }
      return;
    }
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) { wrap.style.transition = 'none'; wrap.style.setProperty('--wx', `${dx}px`); wrap.style.setProperty('--wy', `${dy}px`); }
  });
  moButton.addEventListener('pointerup', e => {
    if (holding?.via === 'mo') { clearTimeout(drag?.timer); drag = null; return endHold('stop'); }
    if (!drag) return;
    clearTimeout(drag.timer);
    const moved = drag.moved;
    drag = null;
    wrap.style.transition = '';
    if (!moved) return holdHint();
    // Snap to the nearest corner and remember it.
    const next = (e.clientY < innerHeight / 2 ? 't' : 'b') + (e.clientX < innerWidth / 2 ? 'l' : 'r');
    setCorner(next);
    goHome();
    chrome.storage.local.set({ moCorner: next }).catch(() => {});
  });

  root.querySelector('.more').addEventListener('click', () => { menu.hidden = !menu.hidden; });
  menu.addEventListener('click', async e => {
    const act = e.target.closest('button')?.dataset.act;
    menu.hidden = true;
    if (act === 'talk') holdHint();
    if (act === 'panel') {
      const r = await chrome.runtime.sendMessage({ type: 'showme:open-panel' }).catch(() => null);
      if (!r?.ok) say('Click the Show Me icon in the toolbar to open the panel.');
    }
    if (act === 'hide') {
      const { moHiddenHosts = [] } = await chrome.storage.local.get('moHiddenHosts');
      await chrome.storage.local.set({ moHiddenHosts: [...new Set([...moHiddenHosts, location.host])] });
      applyHidden(true);
    }
  });
  let bubbleAction = null; // what clicking an "ask" bubble does: 'teach' or 'mic'
  bubble.addEventListener('click', () => {
    if (bubble.classList.contains('ask')) chrome.runtime.sendMessage({ type: 'showme:bubble', action: bubbleAction || 'teach' }).catch(() => {});
    hideBubble();
  });

  function setCorner(next) {
    wrap.classList.remove(corner);
    corner = next;
    wrap.classList.add(corner);
  }

  function applyHidden(hide) {
    hiddenHere = hide;
    wrap.classList.toggle('hidden', hide || !!document.fullscreenElement);
    host.dataset.hidden = String(hide);
  }

  document.addEventListener('fullscreenchange', () => applyHidden(hiddenHere));

  chrome.storage.local.get(['moCorner', 'moHiddenHosts']).then(({ moCorner, moHiddenHosts = [] }) => {
    if (['br', 'bl', 'tr', 'tl'].includes(moCorner)) setCorner(moCorner);
    applyHidden(moHiddenHosts.includes(location.host));
  }).catch(() => {});

  function handleMessage(msg, reply) {
    if (msg.type === 'showme:mo') {
      if (msg.state === 'show') { chrome.storage.local.get('moHiddenHosts').then(({ moHiddenHosts = [] }) => chrome.storage.local.set({ moHiddenHosts: moHiddenHosts.filter(h => h !== location.host) })); applyHidden(false); }
      else if (msg.state === 'acting') { setState('acting', { text: msg.text, hold: 0 }); actOn(msg.targetId); }
      else if (msg.state === 'learning') { setState('learning', { text: msg.text, hold: 3200 }); flyCards(msg.count); }
      else if (msg.state === 'stuck') { bubbleAction = msg.action || 'teach'; setState('stuck', { text: msg.text || 'Can you show me?', ask: true, hold: 15000 }); }
      else if (msg.state === 'success') setState('success', { text: msg.text || 'Done!', hold: 2500 });
      else setState(msg.state || 'idle', { text: msg.text, hold: msg.hold || 0 });
      reply({ ok: true });
      return false;
    }
    if (msg.type === 'showme:voice') { voice(msg); reply({ ok: true }); return false; }
    return false;
  }

  // ---- eyes: follow the pointer, blink like something alive --------------------

  const pupils = [...root.querySelectorAll('.pupil')];
  const PUPIL_HOME = [[24, 31], [40, 31]]; // eye centres in the SVG
  const REACH_X = 1.9, REACH_Y = 2.4;      // how far a pupil can travel inside its eye
  let pointer = null;
  let gazeFrame = null;
  let lastMove = 0;
  let blinkTimer = null;

  function lookAt(x, y) {
    const box = moButton.getBoundingClientRect();
    if (!box.width) return;
    const scale = box.width / 64;
    pupils.forEach((pupil, i) => {
      const [hx, hy] = PUPIL_HOME[i];
      const dx = x - (box.left + hx * scale);
      const dy = y - (box.top + hy * scale);
      const dist = Math.hypot(dx, dy) || 1;
      // Ease off for nearby points so the eyes don't snap to their edges.
      const pull = Math.min(1, dist / 160);
      pupil.setAttribute('cx', (hx + (dx / dist) * REACH_X * pull).toFixed(2));
      pupil.setAttribute('cy', (hy + 1 + (dy / dist) * REACH_Y * pull).toFixed(2));
    });
    const [lx, ly] = PUPIL_HOME[0];
    host.dataset.look = `${(+pupils[0].getAttribute('cx') - lx).toFixed(1)},${(+pupils[0].getAttribute('cy') - ly - 1).toFixed(1)}`; // for tests
    // Pupils widen a little when the pointer comes close: Mo notices you.
    const near = Math.hypot(x - (box.left + box.width / 2), y - (box.top + box.height / 2)) < 110;
    pupils.forEach(p => p.setAttribute('r', near ? '2.9' : '2.5'));
  }

  function lookHome() {
    host.dataset.look = '0.0,0.0';
    pupils.forEach((pupil, i) => { pupil.setAttribute('cx', PUPIL_HOME[i][0] + 1); pupil.setAttribute('cy', PUPIL_HOME[i][1] + 1); pupil.setAttribute('r', '2.5'); });
  }

  // While thinking Mo looks up and away; while acting it watches its target; otherwise it follows you.
  function gazeTarget() {
    const st = wrap.dataset.state;
    const box = moButton.getBoundingClientRect();
    if (st === 'thinking') return [box.right + 80, box.top - 120];
    if (st === 'listening') return [box.left + box.width / 2, box.top - 200];
    if (st === 'acting' && actingTarget) {
      const r = actingTarget.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    }
    return pointer;
  }

  function updateGaze() {
    gazeFrame = null;
    const target = gazeTarget();
    if (!target || (wrap.dataset.state === 'idle' && Date.now() - lastMove > 5000)) return lookHome();
    lookAt(target[0], target[1]);
  }
  function queueGaze() { if (!gazeFrame) gazeFrame = requestAnimationFrame(updateGaze); }

  function onPointerMove(e) {
    pointer = [e.clientX, e.clientY];
    lastMove = Date.now();
    queueGaze();
  }
  document.addEventListener('pointermove', onPointerMove, { passive: true, capture: true });
  const drift = setInterval(queueGaze, 1000); // drift home after the pointer goes quiet

  // Blinks at irregular intervals (2–6 s), sometimes twice in a row, never in lockstep.
  function blink(times = 1) {
    host.dataset.blinks = String((+host.dataset.blinks || 0) + 1); // for tests
    wrap.classList.add('blink');
    setTimeout(() => {
      wrap.classList.remove('blink');
      if (times > 1) setTimeout(() => blink(times - 1), 140);
    }, 110);
  }
  function scheduleBlink() {
    blinkTimer = setTimeout(() => {
      if (!document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) blink(Math.random() < 0.18 ? 2 : 1);
      scheduleBlink();
    }, 2000 + Math.random() * 4000);
  }
  scheduleBlink();

  const onMessage = (msg, _sender, reply) => handleMessage(msg, reply);
  chrome.runtime.onMessage.addListener(onMessage);

  function dispose() {
    clearTimeout(wanderTimer); clearTimeout(stateTimer); clearTimeout(bubbleTimer); clearInterval(heartbeat);
    clearTimeout(blinkTimer); clearInterval(drift); if (gazeFrame) cancelAnimationFrame(gazeFrame);
    document.removeEventListener('pointermove', onPointerMove, { capture: true });
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* already dead */ }
    host.remove();
  }
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  // A copy orphaned by an extension reload removes itself, so a fresh one can take over.
  const heartbeat = setInterval(() => { if (!alive()) dispose(); }, 2000);
  window.__showMeMo = { alive, dispose };

  wander();
})();
