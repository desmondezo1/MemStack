// The Mubit tab: proof, live, that every decision goes through Mubit and that
// corrections become training data. Fed by the backend's event stream (/api/events)
// plus a full refresh (/api/overview) after each event.

const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtUsd = n => (n == null ? '—' : n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(4)}`);
const timeOf = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const goalKey = g => String(g || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function createMubitView({ api, getServer, onOverview = () => {} }) {
  let source = null;
  let refreshTimer = null;
  let dotTimer = null;
  let overview = null;
  let bridge = null;

  function connect() {
    source?.close();
    source = new EventSource(`${getServer()}/api/events`);
    source.addEventListener('call', e => {
      const call = JSON.parse(e.data);
      addCall(call, true);
      animatePacket(call);
      pulseDot();
      scheduleRefresh();
    });
    for (const type of ['run', 'lesson', 'settings']) source.addEventListener(type, scheduleRefresh);
  }

  function pulseDot() {
    $('live-dot').classList.add('on');
    clearTimeout(dotTimer);
    dotTimer = setTimeout(() => $('live-dot').classList.remove('on'), 700);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 400);
  }

  function animatePacket(call) {
    const g = $('packets');
    if (!g) return;
    const train = call.kind === 'training';
    const paths = train ? ['flow-main', 'flow-train'] : ['flow-main'];
    paths.forEach((pathId, i) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '4');
      dot.setAttribute('class', `packet${train ? ' train' : ''}${call.ok ? '' : ' fail'}`);
      dot.setAttribute('cx', '-20');
      const motion = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
      motion.setAttribute('dur', train && i === 0 ? '0.6s' : '0.9s');
      motion.setAttribute('begin', 'indefinite');
      motion.setAttribute('fill', 'freeze');
      // A training packet stops at Mubit and drops into the examples bucket.
      if (train && i === 0) { motion.setAttribute('keyPoints', '0;0.71'); motion.setAttribute('keyTimes', '0;1'); motion.setAttribute('calcMode', 'linear'); }
      const mpath = document.createElementNS('http://www.w3.org/2000/svg', 'mpath');
      mpath.setAttribute('href', `#${pathId}`);
      motion.appendChild(mpath);
      dot.appendChild(motion);
      dot.setAttribute('transform', 'translate(20 0)');
      setTimeout(() => {
        g.appendChild(dot);
        dot.removeAttribute('transform');
        dot.removeAttribute('cx');
        try { motion.beginElement(); } catch { /* SMIL unavailable: no animation */ }
        setTimeout(() => {
          dot.remove();
          if (train && i === 1) {
            const bucket = document.querySelector('.flow-node.bucket');
            bucket?.classList.remove('bump'); void bucket?.getBoundingClientRect(); bucket?.classList.add('bump');
          }
        }, 950);
      }, i * 600);
    });
  }

  function callRow(call) {
    const li = document.createElement('li');
    const train = call.kind === 'training';
    if (train) li.classList.add('train');
    if (!call.ok) li.classList.add('fail');
    const nums = call.provider === 'mock' ? 'mock' : `${call.ms} ms · ${fmtUsd(call.costUsd ?? 0)}`;
    li.innerHTML =
      `<span class="task">${esc(call.task)}${train ? ' <span class="badge train">training</span>' : ''}</span>` +
      `<span class="what" title="${esc(call.summary || call.error || '')}">${esc(call.ok ? (call.summary || '') : (call.error || 'failed'))}</span>` +
      `<span class="nums">${nums}</span>` +
      (call.requestId ? `<span class="rid" title="Click to copy. Find this call in Mubit → Requests.">${esc(call.requestId)}</span>` : '');
    li.querySelector('.rid')?.addEventListener('click', () => navigator.clipboard?.writeText(call.requestId));
    return li;
  }

  function addCall(call, isNew) {
    const list = $('calls');
    if (list.firstElementChild?.classList.contains('muted')) list.innerHTML = '';
    const li = callRow(call);
    if (isNew) li.classList.add('new');
    list.prepend(li);
    while (list.children.length > 40) list.lastElementChild.remove();
  }

  async function refresh() {
    try {
      overview = await api('/api/overview');
    } catch (err) {
      $('ledger').innerHTML = `<p class="muted">Backend offline: ${esc(err.message)}</p>`;
      return null;
    }
    render();
    onOverview(overview);
    return overview;
  }

  function setBridge(data) {
    bridge = data;
    if (overview) render();
  }

  function render() {
    const { ledger, calls, runs, lessons } = overview;
    const t = ledger.totals || {};
    const taught = ledger.tasks.reduce((n, x) => n + (x.trainingViaMubit || 0), 0); // examples that really reached Mubit
    $('stat-calls').textContent = t.callsViaMubit ?? 0;
    $('stat-taught').textContent = taught;
    $('stat-lessons').textContent = lessons.length;
    $('stat-spent').textContent = fmtUsd(t.providerUsd || 0);
    $('flow-bucket').textContent = `${taught} example${taught === 1 ? '' : 's'}`;

    const list = $('calls');
    if (!list.querySelector('li:not(.muted)') && calls.length) {
      list.innerHTML = '';
      for (const call of calls) list.appendChild(callRow(call));
    }

    renderTasks(ledger);
    renderLessons(lessons);
    renderImprovements(runs, lessons);
    renderCosts(ledger);
  }

  function renderTasks(ledger) {
    const box = $('ledger');
    if (!ledger.tasks.length) { box.innerHTML = '<p class="muted small">No calls yet. Run the agent first.</p>'; return; }
    const fromConsole = name => bridge?.tasks?.find(b => b.task === name);
    const rows = ledger.tasks.map(t => {
      const b = fromConsole(t.task);
      const kept = b?.kept != null ? `${b.kept}/${b.needed ?? 25}` : '—';
      const status = b?.status ? esc(b.status) + (b.matched != null ? ` · matched ${b.matched}%` : '') : '<span class="muted">open the console</span>';
      return `
      <tr>
        <td><b>${esc(t.task)}</b></td>
        <td>${t.live}</td>
        <td>${t.training}</td>
        <td>${t.sentToMubit}/${t.keptExamplesNeeded}<div class="bar"><span style="width:${Math.round(100 * t.towardsFirstTraining / t.keptExamplesNeeded)}%"></span></div></td>
        <td>${kept}</td>
        <td>${status}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `
      <table>
        <thead><tr><th>Task</th><th>Live</th><th>Taught</th><th>Sent</th><th>Kept</th><th>Mubit status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    $('bridge-status').textContent = bridge?.at
      ? `Kept and status read from your Mubit console at ${timeOf(bridge.at)}.`
      : '“Sent” is what we sent; Mubit keeps only some calls as examples. Open Mubit → Tasks in a tab to fill in Kept and status.';
  }

  function renderLessons(lessons) {
    const box = $('lessons');
    if (!lessons.length) { box.innerHTML = '<li class="muted small">No lessons yet. When the agent fails, press “Show me how”.</li>'; return; }
    box.innerHTML = [...lessons].reverse().map(l => {
      const tr = l.training;
      const sent = tr ? (tr.viaMubit ? `→ <b>${tr.sent} training examples via Mubit</b> (Claude matched ${tr.agreed}/${l.steps})` : `→ ${tr.sent} examples (mock, not sent)`) : '';
      return `<li><b>${timeOf(l.createdAt)}</b> “${esc(l.goal)}” · taught ${l.steps} steps ${sent}</li>`;
    }).join('');
  }

  function renderImprovements(runs, lessons) {
    const box = $('improvements');
    if (!runs.length) { box.innerHTML = '<p class="muted small">Runs appear here.</p>'; return; }
    const byGoal = new Map();
    for (const r of runs) {
      const key = goalKey(r.goal);
      if (!byGoal.has(key)) byGoal.set(key, { goal: r.goal, runs: [] });
      byGoal.get(key).runs.push(r);
    }
    box.innerHTML = [...byGoal.values()].reverse().slice(0, 8).map(g => {
      const marks = g.runs.slice(-10).map(r => r.outcome === 'done'
        ? `<span class="s${r.usedLesson ? ' l' : ''}" title="${r.usedLesson ? 'succeeded using a lesson' : 'succeeded'}">✓</span>`
        : r.outcome === 'stopped' ? '<span title="stopped">·</span>'
        : `<span class="f" title="${esc(r.outcome)}">✗</span>`).join('');
      const firstFail = g.runs.findIndex(r => r.outcome !== 'done' && r.outcome !== 'stopped');
      const fixed = firstFail !== -1 && g.runs.slice(firstFail).some(r => r.outcome === 'done' && r.usedLesson);
      const n = lessons.filter(l => goalKey(l.goal) === goalKey(g.goal)).length;
      const note = fixed ? `Fixed after ${n || 1} lesson${n > 1 ? 's' : ''}` : g.runs.every(r => r.outcome === 'done') ? 'Worked first time' : 'Not fixed yet: teach it';
      return `<div class="goal"><span>${esc(g.goal)}</span><span class="marks">${marks}</span><span class="note">${note}</span></div>`;
    }).join('');
  }

  function renderCosts(ledger) {
    const t = ledger.totals || {};
    const next = ledger.tasks.find(x => x.task === 'next-action') || ledger.tasks[0];
    const box = $('costs');
    if (!next || next.providerCostPer1k == null) {
      box.innerHTML = '<p class="muted small">Costs appear once calls go through Mubit (mock calls are free and not counted).</p>';
      return;
    }
    const label = t.adapterMeasured ? 'Adapter · measured in Try models' : 'Adapter · estimate';
    const m = next.monthlyAt50kPerDay;
    box.innerHTML = `
      <div class="compare">
        <div><div class="muted small">${esc(next.model || ledger.model)} via Mubit · per 1k decisions</div><div class="num">${fmtUsd(next.providerCostPer1k)}</div><div class="muted small">p50 ${next.p50Ms ?? '—'} ms</div></div>
        <div class="adapter"><div class="muted small">${label} · per 1k</div><div class="num">${fmtUsd(next.adapterCostPer1kEstimate)}</div><div class="muted small">p50 ~${next.adapterP50MsEstimate} ms</div></div>
      </div>
      <p class="small">At 50k decisions a day: <b>${fmtUsd(m.provider)}</b>/month on Claude vs <b>${fmtUsd(m.adapterEstimate)}</b> on the adapter${t.adapterMeasured ? '' : ' (estimate)'}.</p>`;
  }

  async function saveRealNumbers(clear = false) {
    const ratio = $('set-ratio').value;
    const latency = $('set-latency').value;
    const body = clear ? { adapterCostRatio: null, adapterLatencyMs: null } : {
      ...(ratio !== '' && { adapterCostRatio: Number(ratio) / 100 }),
      ...(latency !== '' && { adapterLatencyMs: Number(latency) }),
    };
    await api('/api/settings', { method: 'POST', body });
    await refresh();
  }

  return { connect, refresh, setBridge, saveRealNumbers, get overview() { return overview; } };
}
