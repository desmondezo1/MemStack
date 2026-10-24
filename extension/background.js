// Background worker.
// - Toolbar icon opens the side panel. Nothing else opens it on its own.
// - Push to talk: Mo (on the page) reports when ⌥Space or Mo is held and released.
//   If the side panel is open it listens and runs the goal where you can watch;
//   otherwise a hidden offscreen page listens and the agent runs here, with Mo narrating.

import { runAgent, createApi, getServer, mo } from './agent-core.js';

const api = createApi(getServer);
const panels = new Set();     // open side panels (each keeps a port to us)
let voice = null;             // { host: 'panel' | 'offscreen', tabId }
let headless = null;          // a voice run in progress while the panel is closed

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  self.injectIntoOpenTabs();
});

// Chrome only runs manifest content scripts in tabs opened after the extension loads.
// On install and on every reload, add them to the tabs that are already open, so Mo and
// the agent work there without refreshing each page.
self.injectIntoOpenTabs = async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});
  const results = await Promise.all(tabs.filter(t => /^(https?|file):/.test(t.url || '')).map(tab =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js', 'mascot.js'] }).then(() => true, () => false)));
  return results.filter(Boolean).length;
};

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'panel') return;
  panels.add(port);
  port.onDisconnect.addListener(() => panels.delete(port));
});

// The offscreen page says when its script is listening; a message sent before that is lost.
let offscreenReady = null;
let markOffscreenReady = () => {};

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length && offscreenReady) return offscreenReady;
  offscreenReady = new Promise(resolve => { markOffscreenReady = resolve; setTimeout(resolve, 3000); });
  if (!existing.length) {
    await chrome.offscreen.createDocument({
      url: 'voice.html',
      reasons: ['USER_MEDIA'],
      justification: 'Listen to a spoken instruction while the talk key or Mo is held',
    });
  } else {
    markOffscreenReady();
  }
  return offscreenReady;
}

function toPanels(message) { for (const port of panels) port.postMessage(message); }

async function voiceStart(tabId) {
  if (panels.size) {
    voice = { host: 'panel', tabId, starting: Promise.resolve() };
    toPanels({ type: 'voice-start', tabId });
    return;
  }
  // Creating the offscreen page the first time takes a moment: a release that comes in
  // meanwhile must wait for the start to land, or listening would never stop.
  const v = { host: 'offscreen', tabId };
  voice = v;
  v.starting = (async () => {
    try {
      await ensureOffscreen();
      const { voiceTestScript } = await chrome.storage.local.get('voiceTestScript'); // tests only
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'voice-start', tabId, testScript: voiceTestScript });
    } catch (err) {
      mo(tabId, 'idle', { text: `I can't listen right now: ${err.message}`, hold: 5000 });
      if (voice === v) voice = null;
    }
  })();
}

function voiceEnd(kind) {
  const v = voice;
  if (!v) return;
  v.starting.then(() => {
    if (v.host === 'panel') toPanels({ type: `voice-${kind}` });
    else chrome.runtime.sendMessage({ target: 'offscreen', type: `voice-${kind}` }).catch(() => {});
  });
}

// A voice goal while the side panel is closed: run it here; Mo shows each step.
async function runHeadless(tabId, goal) {
  if (headless) return mo(tabId, 'idle', { text: 'I\'m still working on the last one.', hold: 3000 });
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  headless = { tabId, goal, startUrl: tab.url };
  try {
    const r = await runAgent({ goal, tabId, api });
    if (r.outcome === 'done') {
      mo(tabId, 'success', r.answer ? { text: r.answer, hold: 10000 } : { text: r.usedLesson ? 'Done, using what you taught me!' : 'Done!' });
    } else if (r.outcome === 'failed' || r.outcome === 'asked') {
      // Teaching needs the panel: keep what's needed so it can pick up from here.
      await chrome.storage.session.set({ pendingTeach: { goal, tabId, startUrl: headless.startUrl, failure: r.failure, at: Date.now() } });
      mo(tabId, 'stuck', { action: 'teach', text: `${r.asked ? r.failure : `I couldn't finish: ${r.failure}`} Click here to show me how.` });
    } else if (r.outcome === 'error') {
      mo(tabId, 'idle', { text: `Something went wrong: ${r.failure}`, hold: 6000 });
    }
  } finally {
    headless = null;
  }
}

async function shouldAutorun() {
  const { autorun } = await chrome.storage.local.get('autorun');
  return autorun !== false;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id ?? msg.tabId;
  switch (msg.type) {
    // From Mo on the page.
    case 'showme:voice-start': voiceStart(tabId); break;
    case 'showme:voice-stop': voiceEnd('stop'); break;
    case 'showme:voice-cancel': voiceEnd('cancel'); break;
    case 'showme:bubble':
      if (msg.action === 'mic') chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') });
      else {
        // Try to open the panel (allowed when Chrome counts the click as a user action);
        // an open panel picks up the pending lesson either way.
        chrome.sidePanel.open({ tabId }).catch(() => mo(tabId, 'idle', { text: 'Click the Show Me icon in the toolbar to teach me.', hold: 5000 }));
        chrome.runtime.sendMessage({ type: 'showme:teach-request' }).catch(() => {});
      }
      break;
    case 'showme:open-panel':
      chrome.sidePanel.open({ windowId: sender.tab.windowId }).then(() => reply({ ok: true }), err => reply({ ok: false, error: err.message }));
      return true;

    // From the offscreen voice page.
    case 'voice:ready': markOffscreenReady(); break;
    case 'voice:levels':
      chrome.tabs.sendMessage(msg.tabId, { type: 'showme:voice', state: 'listening', id: msg.id, levels: msg.levels, text: msg.text }).catch(() => {});
      break;
    case 'voice:error':
      if (msg.error === 'not-allowed' || msg.error === 'service-not-allowed') {
        mo(msg.tabId, 'stuck', { action: 'mic', text: 'I need the microphone once. Click here to allow it.' });
      } else {
        mo(msg.tabId, 'idle', { text: `I couldn't listen: ${msg.error}.`, hold: 4000 });
      }
      break;
    case 'voice:result': {
      const heard = !msg.cancelled && msg.text;
      chrome.tabs.sendMessage(msg.tabId, { type: 'showme:voice', state: heard ? 'heard' : (msg.cancelled ? 'cancelled' : 'off'), id: msg.id, text: msg.text }).catch(() => {});
      voice = null;
      if (heard) shouldAutorun().then(go => go ? runHeadless(msg.tabId, msg.text) : mo(msg.tabId, 'idle', { text: `“${msg.text}”. Open the panel and press Run.`, hold: 5000 }));
      break;
    }
  }
  return false;
});
