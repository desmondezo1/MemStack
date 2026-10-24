// Offscreen voice host: the background asks it to start, stop or cancel listening when
// the side panel is closed. Waveform updates and the final words go back to the
// background, which passes them on to Mo and runs the agent.

import { createVoiceSession } from './voice-core.js';

let session = null;
let sessionTab = null;

// Tests can't use a real microphone: they store a script of what "was said", which the
// background passes along (offscreen pages only get chrome.runtime, not chrome.storage).
function installTestSpeech(voiceTestScript) {
  if (!voiceTestScript) return;
  self.SpeechRecognition = class {
    start() {
      this.timers = voiceTestScript.map(([ms, text, isFinal]) => setTimeout(() => {
        this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal })] });
      }, ms));
    }
    stop() { this.timers?.forEach(clearTimeout); setTimeout(() => this.onend?.(), 20); }
    abort() { this.timers?.forEach(clearTimeout); setTimeout(() => this.onend?.(), 20); }
  };
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.target !== 'offscreen') return false;
  if (msg.type === 'voice-start') start(msg.tabId, msg.testScript);
  if (msg.type === 'voice-stop') session?.stop();
  if (msg.type === 'voice-cancel') session?.cancel();
  return false;
});

chrome.runtime.sendMessage({ type: 'voice:ready' }).catch(() => {});

function start(tabId, testScript) {
  if (session && !session.ended) session.cancel();
  installTestSpeech(testScript);
  sessionTab = tabId;
  const s = createVoiceSession({
    onLevels: ({ id, seq, levels, text }) => chrome.runtime.sendMessage({ type: 'voice:levels', tabId: sessionTab, id, seq, levels, text }).catch(() => {}),
    onError: ({ id, error }) => chrome.runtime.sendMessage({ type: 'voice:error', tabId: sessionTab, id, error }).catch(() => {}),
    onEnd: ({ id, text, cancelled }) => chrome.runtime.sendMessage({ type: 'voice:result', host: 'offscreen', tabId: sessionTab, id, text, cancelled }).catch(() => {}),
  });
  session = s;
  s.start();
}
