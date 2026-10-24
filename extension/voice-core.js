// One push-to-talk session: speech recognition plus a live loudness meter, used by the
// side panel (when it's open) and by the hidden offscreen page (when it isn't).
// start() while the key is held, stop() on release (the words go on to run), cancel()
// to throw them away. Each session has an id so late waveform updates from a finished
// session can be told apart and ignored.

const BARS = 20;

export function createVoiceSession({ onLevels, onEnd, onError }) {
  const id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let recognition = null;
  let meter = null;
  let finalText = '';
  let interim = '';
  let cancelled = false;
  let ended = false;
  let loud = 0; // synthetic wave height when the real mic level isn't available

  function words() { return (finalText + ' ' + interim).replace(/\s+/g, ' ').trim(); }

  // The wave shows at once (animated, bumped by speech); once the microphone is ready
  // it switches to the real loudness. Where Chrome can't show a permission prompt (the
  // offscreen page) the mic request can hang, so it only gets a moment.
  async function startMeter() {
    const synthetic = () => {
      loud = Math.max(0, loud - 0.08);
      const t = Date.now() / 160;
      return Array.from({ length: BARS }, (_, i) => Math.max(0.08, (0.15 + loud) * (0.55 + 0.45 * Math.sin(t + i * 0.7))));
    };
    let read = synthetic;
    let seq = 0;
    meter = { timer: setInterval(() => { if (!ended) onLevels({ id, seq: ++seq, levels: read(), text: words() }); }, 70) };
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('mic timeout')), 800)),
      ]);
      if (ended) { stream.getTracks().forEach(t => t.stop()); return; }
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      Object.assign(meter, { stream, ctx });
      read = () => {
        analyser.getByteFrequencyData(data);
        return Array.from({ length: BARS }, (_, i) => Math.min(1, data[Math.floor((i * data.length) / BARS)] / 200));
      };
    } catch {
      // keep the animated wave
    }
  }

  function stopMeter() {
    if (!meter) return;
    clearInterval(meter.timer);
    meter.stream?.getTracks().forEach(t => t.stop());
    meter.ctx?.close().catch(() => {});
    meter = null;
  }

  function finish(error) {
    if (ended) return;
    ended = true;
    stopMeter();
    if (error) onError?.({ id, error });
    onEnd({ id, text: cancelled ? '' : words(), cancelled: cancelled || !!error });
  }

  return {
    id,
    start() {
      const Speech = self.SpeechRecognition || self.webkitSpeechRecognition;
      if (!Speech) { finish('unsupported'); return; }
      recognition = new Speech();
      recognition.lang = navigator.language || 'en-GB';
      recognition.interimResults = true;
      recognition.continuous = true; // keep listening for as long as the key is held
      recognition.onresult = event => {
        loud = 0.8;
        let f = '', i = '';
        for (const r of event.results) (r.isFinal ? (f += ' ' + r[0].transcript) : (i += ' ' + r[0].transcript));
        finalText = f; interim = i;
      };
      recognition.onspeechstart = () => { loud = 0.8; };
      recognition.onerror = event => {
        // "no-speech" and "aborted" just mean nothing was said or we cancelled.
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        finish(event.error);
      };
      recognition.onend = () => finish();
      try { recognition.start(); } catch (err) { finish(err.message); return; }
      startMeter();
    },
    stop() { if (!ended) { try { recognition?.stop(); } catch { finish(); } } },
    cancel() {
      cancelled = true;
      if (!ended) { try { recognition?.abort(); } catch { /* ignore */ } finish(); }
    },
    get ended() { return ended; },
  };
}
