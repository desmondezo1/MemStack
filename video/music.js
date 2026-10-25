// The film's music bed, composed in code to the film's own timing: silent while the clicks
// build, a warm chord when Mo lands, a pulse while Ada teaches, a lift while Mo works the rows,
// a drop for the correction, a build into Mubit, a beat of silence, and one last chord.
// D major, 100 BPM. Writes out/music.wav (48 kHz stereo); voice.js mixes it under the voice.
// --story scores the Sarah film instead (out/story-music.wav): warm through her morning, gone
// during the Monday grind, back when Mo appears, driving while Mo works, and a final chord.
//
//   node music.js
//   node music.js --story

import fs from 'node:fs';
import path from 'node:path';

const STORY = process.argv.includes('--story');
const RATE = 48000;
const LEN = STORY ? 105 : 60;
const N = LEN * RATE;
const L = new Float32Array(N), R = new Float32Array(N);
const BEAT = 0.6, BAR = 2.4;
const T0 = STORY ? 0.8 : 7.42; // the first downbeat (intro: Mo lands)
const STOP = STORY ? 98.0 : 55.55, FINAL = STORY ? 99.2 : 56.05; // a beat of silence, then the last chord
const midi = n => 440 * 2 ** ((n - 69) / 12);
let seed = 11;
const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };

// Each section's ingredients, by time.
const between = (t, a, b) => t >= a && t < b;
// Story times are the film's (105 s, with the explainer at 23 to 29 s).
const has = STORY ? {
  pad: t => between(t, T0, 28.8) || between(t, 40.4, STOP),
  bass: t => between(t, 48.4, 75.8) || between(t, 83.6, STOP),
  arp: t => between(t, 1.6, 16.8) || between(t, 40.6, 45.2) || between(t, 49.0, 75.8) || between(t, 86.0, STOP),
  kick: t => between(t, 50.6, 75.8) || between(t, 90.6, STOP),
  hat: t => between(t, 61.4, 75.6), 
} : {
  pad: t => between(t, T0, 55.55) || t >= 56.05,
  bass: t => between(t, T0, 40.0) || between(t, 43.6, 55.55),
  arp: t => between(t, 8.6, 40.0) || between(t, 44.0, 55.55),
  kick: t => between(t, 13.0, 40.0) || between(t, 46.0, 55.55),
  hat: t => between(t, 27.4, 39.6) || between(t, 49.6, 55.55),
};
// Softer stretches: [from, to, level].
const SOFT = STORY ? [[17.0, 29.0, 0.55], [76.0, 83.6, 0.8], [40.4, 45.4, 0.85]] : [[40.0, 43.6, 0.7]];
const softAt = t => (SOFT.find(([a, b]) => between(t, a, b)) || [0, 0, 1])[2];
// Chords: Dmaj9, Bm9, Gmaj7(#11-ish), A6sus: one bar each, round and round.
const CHORDS = [
  { root: 38, notes: [62, 66, 69, 73, 76] },
  { root: 35, notes: [62, 66, 69, 71, 73] },
  { root: 31, notes: [62, 66, 67, 71, 74] },
  { root: 33, notes: [61, 64, 66, 69, 71] },
];
const chordAt = t => CHORDS[Math.floor(Math.max(0, t - T0) / BAR) % 4];

function add(at, dur, fn, pan = 0) {
  const s = Math.max(0, Math.round(at * RATE)), e = Math.min(N, Math.round((at + dur) * RATE));
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = s; i < e; i++) { const v = fn((i - s) / RATE, i / RATE); L[i] += v * gl; R[i] += v * gr; }
}
const env = (x, a, d, len) => Math.min(1, x / a) * Math.min(1, Math.max(0, (len - x) / d));

// Pad: each chord tone as two slightly detuned voices with a few soft harmonics, slow attack.
function pad(at, dur, notes, level) {
  notes.forEach((n, k) => {
    const f = midi(n);
    for (const det of [-0.0035, 0.0035]) {
      const ff = f * (1 + det);
      add(at, dur + 1.2, x => level * env(x, 0.9, 1.4, dur + 1.2) * (Math.sin(2 * Math.PI * ff * x) + 0.3 * Math.sin(4 * Math.PI * ff * x) + 0.08 * Math.sin(6 * Math.PI * ff * x)) / notes.length, det < 0 ? -0.35 + k * 0.05 : 0.35 - k * 0.05);
    }
  });
}
function bass(at, dur, n, level) {
  const f = midi(n);
  add(at, dur, x => level * env(x, 0.04, 0.25, dur) * (Math.sin(2 * Math.PI * f * x) + 0.25 * Math.sin(4 * Math.PI * f * x)));
}
function mallet(at, n, level, pan) {
  const f = midi(n);
  add(at, 1.1, x => level * Math.exp(-x * 5.5) * Math.min(1, x / 0.004) * (Math.sin(2 * Math.PI * f * x) + 0.35 * Math.sin(2 * Math.PI * f * 3.01 * x) * Math.exp(-x * 12)), pan);
}
function kick(at, level) {
  add(at, 0.35, x => level * Math.exp(-x * 11) * Math.sin(2 * Math.PI * (48 + 75 * Math.exp(-x * 28)) * x));
}
function hat(at, level, pan) {
  let prev = 0;
  add(at, 0.06, x => { const n = noise(); const hp = n - prev; prev = n; return level * Math.exp(-x * 70) * hp; }, pan);
}
function swell(at, dur, level) {
  let lp = 0;
  add(at, dur, x => { lp += (noise() - lp) * (0.02 + 0.5 * (x / dur) ** 2); return level * (x / dur) ** 2.2 * lp; });
}
function bell(at, n, level) {
  const f = midi(n);
  add(at, 4, x => level * Math.exp(-x * 1.1) * Math.min(1, x / 0.003) * (Math.sin(2 * Math.PI * f * x) + 0.5 * Math.sin(2 * Math.PI * f * 2.76 * x) * Math.exp(-x * 2) + 0.25 * Math.sin(2 * Math.PI * f * 5.4 * x) * Math.exp(-x * 4)));
}

// ---- The score -------------------------------------------------------------------------
// Bars from Mo's landing to the stop at 55.55 s.
for (let bar = 0; T0 + bar * BAR < STOP; bar++) {
  const at = T0 + bar * BAR;
  const c = CHORDS[bar % 4];
  // A bar that starts mid-section (Mo appearing at 34.4 s) begins where the section does.
  const startAt = has.pad(at) ? at : (has.pad(at + BAR - 0.01) ? Math.max(at, [40.4, 34.4, T0].find(x => x > at && x < at + BAR) ?? at) : null);
  if (startAt !== null && (has.pad(startAt) || has.pad(startAt + 0.01))) {
    const cut = STORY ? 28.8 : 22.8;
    const end = Math.min(at + BAR, STOP, ...(STORY && at < cut && at + BAR > cut ? [cut] : []));
    pad(startAt, Math.max(0.3, end - startAt), c.notes, 0.16 * softAt(startAt));
  }
  if (has.bass(at)) bass(at, Math.min(BAR - 0.05, STOP - at), c.root + 12, 0.18);
}
for (let k = 0; ; k++) {
  const at = T0 + k * BEAT / 2; // eighth notes
  if (at >= STOP) break;
  const c = chordAt(at);
  const arpNotes = [...c.notes, c.notes[1] + 12, c.notes[2] + 12];
  const lift = STORY ? between(at, 61.4, 75.8) || between(at, 93, STOP) : between(at, 27.4, 40.0) || between(at, 49.6, 55.55);
  const build = STORY ? (between(at, 86, 93) ? (at - 86) / 7 : 1) : between(at, 44.0, 49.6) ? (at - 44) / 5.6 : 1;
  if (has.arp(at)) mallet(at, arpNotes[(k * 3) % arpNotes.length] + (lift && k % 8 === 7 ? 12 : 0), (lift ? 0.075 : 0.055) * build * softAt(at), k % 2 ? 0.4 : -0.4);
  if (k % 2 === 0 && has.kick(at)) kick(at, (STORY ? between(at, 50.6, 61.4) : between(at, 13.0, 27.4)) ? 0.32 : 0.42);
  if (k % 2 === 1 && has.hat(at)) hat(at, 0.06, 0.25);
}
// The lift into "Ten starters", and the drop for the correction.
if (STORY) { swell(38.8, 1.6, 0.1); swell(59.8, 1.6, 0.1); } else swell(38.0, 2.0, 0.12);
// The last chord: Dmaj9 with a bell on "Mo. Show it once."
pad(FINAL, 3.4, [50, 57, 62, 66, 69, 73, 76], 0.22);
bass(FINAL, 3.5, 38, 0.2);
bell(FINAL, 81, 0.08);
bell(FINAL + 0.55, 74, 0.05);

// ---- Room: a small reverb (four combs, two all-passes), then a gentle fade at the end ----
function reverb(x) {
  const out = new Float32Array(N);
  for (const [d, g] of [[1557, 0.8], [1617, 0.79], [1491, 0.78], [1422, 0.77]]) {
    const buf = new Float32Array(d); let i = 0, lp = 0;
    for (let n = 0; n < N; n++) { const y = buf[i]; lp = y * 0.6 + lp * 0.4; buf[i] = x[n] + lp * g; i = (i + 1) % d; out[n] += y * 0.25; }
  }
  for (const d of [225, 556]) {
    const buf = new Float32Array(d); let i = 0;
    for (let n = 0; n < N; n++) { const b = buf[i]; const y = -out[n] + b; buf[i] = out[n] + b * 0.5; out[n] = y; i = (i + 1) % d; }
  }
  return out;
}
const wl = reverb(L), wr = reverb(R);
let peak = 0;
for (let n = 0; n < N; n++) {
  const t = n / RATE;
  const fade = t > LEN - 1.8 ? Math.max(0, (LEN - t) / 1.8) : 1;
  L[n] = (L[n] + wl[n] * 0.35) * fade; R[n] = (R[n] + wr[n] * 0.35) * fade;
  peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
}
const gain = 0.8 / peak;
const wav = Buffer.alloc(44 + N * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) {
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[n] * gain)) * 32767), 44 + n * 4);
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[n] * gain)) * 32767), 46 + n * 4);
}
const file = path.join(import.meta.dirname, 'out', STORY ? 'story-music.wav' : 'music.wav');
fs.writeFileSync(file, wav);
console.log(`${file} (${LEN} s, D major, 100 BPM)`);
