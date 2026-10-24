// Runs in every page. Three jobs:
// 1. snapshot: describe the page as a short list of interactive elements (text, no pixels)
// 2. act: perform one action the agent chose
// 3. record: while the human shows the agent how, log each click / selection / typed value

(() => {
  // Same live/dead check as mascot.js: a copy orphaned by an extension reload is replaced.
  const previous = window.__showMeInstalled;
  if (previous?.alive?.()) return;
  previous?.dispose?.();

  const SELECTOR = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=tab]',
    '[role=menuitem]', '[role=option]', '[role=switch]', '[contenteditable=""]', '[contenteditable=true]',
  ].join(',');
  const MAX_ELEMENTS = 80;
  let nextId = 1;

  const clean = (s, max = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

  function idOf(el) {
    if (!el.dataset.showmeId) el.dataset.showmeId = `e${nextId++}`;
    return el.dataset.showmeId;
  }

  function isVisible(el) {
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
      // Custom-styled radios/checkboxes hide the input but show its label.
      const label = el.labels?.[0];
      return !!(label && label.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }));
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'select';
    if (tag === 'textarea' || el.isContentEditable) return 'textbox';
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return type;
      if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
      return 'textbox';
    }
    return tag;
  }

  function labelOf(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ');
      if (clean(text)) return clean(text);
    }
    if (el.labels?.length) return clean(el.labels[0].innerText);
    // A rich-text box's own text is its value, not its name.
    if (el.isContentEditable) {
      return clean(el.getAttribute('placeholder') || el.dataset.placeholder || el.getAttribute('title') || el.closest('[aria-label]')?.getAttribute('aria-label') || 'Text editor');
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && ['submit', 'button', 'reset'].includes(el.type)) return clean(el.value);
    if (tag !== 'select' && tag !== 'textarea' && tag !== 'input' && clean(el.innerText)) return clean(el.innerText);
    return clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || el.id || tag);
  }

  function groupOf(el) {
    const legend = el.closest('fieldset')?.querySelector('legend');
    if (legend) return clean(legend.innerText, 40);
    const group = el.closest('[role=radiogroup],[role=group]');
    return group ? clean(group.getAttribute('aria-label'), 40) : '';
  }

  function describe(el) {
    const role = roleOf(el);
    const item = { id: idOf(el), role, label: labelOf(el) };
    const group = groupOf(el);
    if (group) item.group = group;
    if (role === 'select') {
      item.value = el.value === '' ? '' : clean(el.selectedOptions?.[0]?.text, 40);
      item.options = [...el.options].filter(o => o.value !== '').map(o => clean(o.text, 30));
    } else if (role === 'checkbox' || role === 'radio') {
      item.checked = el.checked ?? el.getAttribute('aria-checked') === 'true';
    } else if (role === 'textbox') {
      item.value = el.type === 'password' ? (el.value ? '***' : '') : clean(el.value ?? el.innerText, 60);
    }
    if (el.disabled) item.disabled = true;
    if (inDialogEl(el)) item.inDialog = true;
    return item;
  }

  const inDialogEl = el => el.closest('dialog,[role=dialog],[aria-modal=true]');

  // Big sites have hundreds of controls; the model sees MAX_ELEMENTS. Keep the ones
  // that matter: search boxes and fields, then what's on screen in the main content,
  // then the rest, and list the survivors in page order.
  function priority(el) {
    const role = roleOf(el);
    const text = `${el.type || ''} ${el.getAttribute('role') || ''} ${labelOf(el)}`;
    if (role === 'textbox' && /search/i.test(text)) return 0;
    const r = el.getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    const inMain = !!el.closest('main,[role=main],#content,#main,article');
    const inChrome = !!el.closest('nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo]');
    if (role === 'textbox' || role === 'select') return onScreen ? 1 : 3;
    if (onScreen && inMain) return 1;
    if (onScreen && !inChrome) return 2;
    if (onScreen) return 3;
    if (inMain) return 4;
    return inChrome ? 6 : 5;
  }

  function snapshot() {
    const all = [...document.querySelectorAll(SELECTOR)].filter(isVisible);
    // An open modal blocks the page: show only what is inside it. Filter before
    // capping, or a dialog at the end of a long page would never be seen.
    const inDialog = all.filter(inDialogEl);
    const pool = (inDialog.length ? inDialog : all).map((el, index) => ({ el, index, p: priority(el) }));
    const kept = pool.sort((a, b) => a.p - b.p || a.index - b.index).slice(0, MAX_ELEMENTS).sort((a, b) => a.index - b.index);
    const headings = [...document.querySelectorAll('h1,h2')].filter(isVisible).map(h => clean(h.innerText, 60)).filter(Boolean);
    const scrollable = document.documentElement.scrollHeight - innerHeight;
    return {
      url: location.href,
      title: clean(document.title, 100),
      headings: headings.slice(0, 5),
      scroll: scrollable > 50 ? `${Math.round((100 * scrollY) / scrollable)}% down, ${all.length} controls on the page` : '',
      elements: kept.map(k => describe(k.el)),
      text: clean(document.body?.innerText, 4000),
    };
  }

  function highlight(el) {
    const prev = el.style.outline;
    el.style.outline = '3px solid #ff5a1f';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = prev; }, 900);
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, value) : (el.value = value);
  }

  function pressKey(target, key) {
    const init = { key, code: key, bubbles: true, cancelable: true, composed: true };
    if (key === 'Enter') Object.assign(init, { keyCode: 13, which: 13 });
    if (key === 'Escape') Object.assign(init, { keyCode: 27, which: 27 });
    const down = target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keypress', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    // Script-made key events don't submit forms by themselves: do what Enter would do.
    if (key === 'Enter' && down) {
      const form = target.form || target.closest?.('form');
      if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
    }
  }

  function act({ action, element_id: id, value = '', submit = false }) {
    if (action === 'scroll') {
      window.scrollBy({ top: (value === 'up' ? -0.8 : 0.8) * innerHeight, behavior: 'instant' });
      return { ok: true };
    }
    if (action === 'press' && !id) {
      pressKey(document.activeElement || document.body, value);
      return { ok: true };
    }
    const el = document.querySelector(`[data-showme-id="${CSS.escape(id)}"]`);
    if (!el) return { ok: false, error: `Element ${id} is not on the page` };
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    highlight(el.labels?.[0] || el);
    if (action === 'click') {
      el.click();
    } else if (action === 'type') {
      el.focus();
      if (el.isContentEditable) el.textContent = value; else setNativeValue(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (submit) pressKey(el, 'Enter');
    } else if (action === 'select') {
      const want = String(value).trim().toLowerCase();
      const option = [...el.options].find(o => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want);
      if (!option) return { ok: false, error: `No option "${value}" in ${labelOf(el)}` };
      el.value = option.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (action === 'press') {
      el.focus();
      pressKey(el, value);
    } else {
      return { ok: false, error: `Unknown action ${action}` };
    }
    return { ok: true };
  }

  // ---- Recorder -------------------------------------------------------------

  let recording = false;
  let pending = null; // { el, page }: snapshot taken at pointerdown, before the click changes the page
  let lastClick = { el: null, at: 0, viaLabel: false };
  const focusPages = new WeakMap();
  const editStart = new WeakMap(); // contenteditable text when focus arrived

  function interactiveTarget(target) {
    if (!(target instanceof Element)) return null;
    const label = target.closest('label');
    if (label?.control) return label.control;
    return target.closest(SELECTOR);
  }

  function emit(step) {
    chrome.runtime.sendMessage({ type: 'showme:recorded', step }).catch(() => {});
  }

  function onPointerDown(event) {
    if (recording) pending = { el: interactiveTarget(event.target), page: snapshot() };
  }

  function onFocusIn(event) {
    if (!recording) return;
    const el = interactiveTarget(event.target);
    if (!el) return;
    focusPages.set(el, snapshot());
    if (el.isContentEditable) editStart.set(el, el.innerText);
  }

  // Rich-text boxes never fire "change": record what was typed when focus leaves.
  function onFocusOut(event) {
    if (!recording) return;
    const el = interactiveTarget(event.target);
    if (!el?.isContentEditable || editStart.get(el) === el.innerText) return;
    const page = focusPages.get(el) || snapshot();
    const item = describe(el);
    emit({ action: 'type', element_id: item.id, label: item.label, role: item.role, value: clean(el.innerText, 200), page });
  }

  function onClick(event) {
    if (!recording) return;
    const el = interactiveTarget(event.target);
    if (!el) return;
    const role = roleOf(el);
    if (role === 'select' || role === 'textbox') return; // recorded on change instead
    // Enter in a form makes the browser "click" its submit button (detail 0): that's
    // part of the "type + Enter" step already recorded, not a click of its own.
    if (event.detail === 0 && Date.now() - lastEnterAt < 1000 && role === 'button') return;
    // A click on a <label> also fires a click on its input: record it once.
    // Two real clicks on the same control are still two steps.
    const now = Date.now();
    if (lastClick.el === el && lastClick.viaLabel && now - lastClick.at < 500) return;
    lastClick = { el, at: now, viaLabel: !!event.target.closest?.('label') && event.target !== el };
    // Use the pointerdown snapshot only if it was for this control (Enter-to-submit has no pointerdown).
    const page = pending?.el === el ? pending.page : snapshot();
    pending = null;
    const item = describe(el);
    emit({ action: 'click', element_id: item.id, label: item.label, role: item.role, value: '', page });
  }

  function onChange(event) {
    if (!recording) return;
    const el = interactiveTarget(event.target);
    if (!el) return;
    const role = roleOf(el);
    if (role !== 'select' && role !== 'textbox') return;
    if (el.type === 'password') return; // never record passwords
    if (submittedByEnter.get(el) === el.value) return; // already recorded as "type + Enter"
    const page = focusPages.get(el) || snapshot();
    const item = describe(el);
    const value = role === 'select' ? clean(el.selectedOptions?.[0]?.text, 40) : clean(el.value, 200);
    emit({ action: role === 'select' ? 'select' : 'type', element_id: item.id, label: item.label, role: item.role, value, page });
  }

  // Typing then pressing Enter (a search box) is one step: type with submit.
  const submittedByEnter = new WeakMap();
  let lastEnterAt = 0;
  function onKeyDown(event) {
    if (!recording || event.key !== 'Enter' || event.isComposing) return;
    const el = interactiveTarget(event.target);
    if (!el || roleOf(el) !== 'textbox' || el.type === 'password' || el.tagName === 'TEXTAREA') return;
    lastEnterAt = Date.now();
    submittedByEnter.set(el, el.value);
    const page = focusPages.get(el) || snapshot();
    const item = describe(el);
    emit({ action: 'type', element_id: item.id, label: item.label, role: item.role, value: clean(el.value ?? el.innerText, 200), submit: true, page });
  }

  const DOM_LISTENERS = [['pointerdown', onPointerDown], ['focusin', onFocusIn], ['focusout', onFocusOut],
    ['click', onClick], ['change', onChange], ['keydown', onKeyDown]];
  for (const [type, fn] of DOM_LISTENERS) document.addEventListener(type, fn, true);

  function setRecording(on) {
    recording = on;
    document.documentElement.classList.toggle('showme-recording', on);
    let badge = document.getElementById('showme-recording-badge');
    if (on && !badge) {
      badge = document.createElement('div');
      badge.id = 'showme-recording-badge';
      badge.textContent = '● Show Me is watching — do the task once';
      Object.assign(badge.style, {
        position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647,
        background: '#ff5a1f', color: '#fff', font: '600 13px system-ui, sans-serif', padding: '6px 14px',
        borderRadius: '999px', boxShadow: '0 4px 14px rgba(0,0,0,.2)', pointerEvents: 'none',
      });
      document.documentElement.appendChild(badge);
    } else if (!on && badge) {
      badge.remove();
    }
  }

  function onMessage(msg, _sender, reply) {
    try {
      if (msg.type === 'showme:ping') reply({ ok: true });
      else if (msg.type === 'showme:snapshot') reply({ ok: true, page: snapshot() });
      else if (msg.type === 'showme:act') reply(act(msg.action));
      else if (msg.type === 'showme:record') { setRecording(!!msg.on); reply({ ok: true }); }
      else return false;
    } catch (err) {
      reply({ ok: false, error: err.message });
    }
    return false;
  }
  chrome.runtime.onMessage.addListener(onMessage);

  function dispose() {
    clearInterval(heartbeat);
    for (const [type, fn] of DOM_LISTENERS) document.removeEventListener(type, fn, true);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* already dead */ }
    recording = false;
    document.getElementById('showme-recording-badge')?.remove();
  }
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const heartbeat = setInterval(() => { if (!alive()) dispose(); }, 2000);
  window.__showMeInstalled = { alive, dispose };
})();
