// Runs in every page. Three jobs:
// 1. snapshot: describe the page as a short list of interactive elements (text, no pixels)
// 2. act: perform one action the agent chose
// 3. record: while the human shows the agent how, log each click / selection / typed value

(() => {
  if (window.__showMeInstalled) return;
  window.__showMeInstalled = true;

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
    if (el.closest('dialog,[role=dialog],[aria-modal=true]')) item.inDialog = true;
    return item;
  }

  function snapshot() {
    const all = [...document.querySelectorAll(SELECTOR)].filter(isVisible);
    // An open modal blocks the page: show only what is inside it. Filter before
    // capping, or a dialog at the end of a long page would never be seen.
    const inDialog = all.filter(el => el.closest('dialog,[role=dialog],[aria-modal=true]'));
    const visible = (inDialog.length ? inDialog : all).slice(0, MAX_ELEMENTS).map(describe);
    const headings = [...document.querySelectorAll('h1,h2')].filter(isVisible).map(h => clean(h.innerText, 60)).filter(Boolean);
    return {
      url: location.href,
      title: clean(document.title, 100),
      headings,
      elements: visible,
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

  function act({ action, element_id: id, value = '' }) {
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
    } else if (action === 'select') {
      const want = String(value).trim().toLowerCase();
      const option = [...el.options].find(o => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want);
      if (!option) return { ok: false, error: `No option "${value}" in ${labelOf(el)}` };
      el.value = option.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
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
    const page = focusPages.get(el) || snapshot();
    const item = describe(el);
    const value = role === 'select' ? clean(el.selectedOptions?.[0]?.text, 40)
      : (el.type === 'password' ? '' : clean(el.value, 200));
    if (el.type === 'password') return; // never record passwords
    emit({ action: role === 'select' ? 'select' : 'type', element_id: item.id, label: item.label, role: item.role, value, page });
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);

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

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
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
  });
})();
