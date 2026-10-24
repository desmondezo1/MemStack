// Mubit bridge: Mubit's console has no public API for kept examples or adapter status,
// so while you have app.mubit.ai open in a tab, this read-only script reads those
// numbers from the page text and shares them with the Show Me panel. It never clicks
// or changes anything. If the console's layout changes, it simply finds nothing.

(() => {
  if (window.__showMeBridge) return;
  window.__showMeBridge = true;

  // Mubit names each task after the first words of its system prompt.
  const OUR_TASKS = [
    ['next-action', /you control a web browser/i],
    ['done-check', /you check whether a browser task/i],
    ['safety-gate', /you protect a user/i],
  ];
  const STATUS = /(v\d+ passed[^\n]*|passed its tests|Passed|Below target[^\n]*|Prompt only|Malformed tool calls|Not tested|Collecting examples|Reviewing examples|Training|Testing|Waiting[^\n]*|Can't train[^\n]*|No adapter yet[^\n]*|Not ready yet)/i;

  function read() {
    const lines = (document.body?.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
    const found = [];
    lines.forEach((line, i) => {
      const match = OUR_TASKS.find(([, re]) => re.test(line));
      if (!match) return;
      // Look at the lines that follow, up to the next task name.
      const block = [];
      for (let j = i; j < Math.min(lines.length, i + 12); j++) {
        if (j > i && OUR_TASKS.some(([, re]) => re.test(lines[j]))) break;
        block.push(lines[j]);
      }
      const text = block.join('\n');
      const kept = text.match(/(\d+)\s+of\s+(\d+)\s+examples/i);
      const matched = text.match(/Matched\s+(\d+)%/i);
      const status = text.match(STATUS);
      found.push({
        task: match[0],
        kept: kept ? Number(kept[1]) : null,
        needed: kept ? Number(kept[2]) : null,
        status: status ? status[1].slice(0, 80) : null,
        matched: matched ? Number(matched[1]) : null,
      });
    });
    if (!found.length) return;
    // Several Mubit tasks can share a name (e.g. old and new prompt versions): keep the most advanced.
    const best = new Map();
    for (const t of found) {
      const prev = best.get(t.task);
      const score = x => (/pass/i.test(x.status || '') ? 1000 : 0) + (x.kept || 0);
      if (!prev || score(t) > score(prev)) best.set(t.task, { ...t, sameName: (prev?.sameName || 1) + (prev ? 1 : 0) });
      else prev.sameName = (prev.sameName || 1) + 1;
    }
    const data = { at: new Date().toISOString(), url: location.href, tasks: [...best.values()] };
    chrome.storage.local.set({ mubitBridge: data }).catch(() => {});
    document.documentElement.dataset.showmeBridge = String(data.tasks.length); // for tests
  }

  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(read, 800); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  read();
})();
