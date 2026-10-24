// Renders intro.html into an MP4, frame by frame. The page draws any moment on demand
// (window.render(t)), so every frame is exact: no screen recording, no dropped frames.
// Sound effects are synthesized here from the page's cue list and mixed in with ffmpeg.
//
//   node render.js                    # out/mo-intro.mp4
//   node render.js --stills           # a still for each scene's key moments, in out/stills/
//   node render.js --stills 3,8.5,20  # stills at these seconds
//   node render.js --from 13 --to 27  # render only part (out/part.mp4), for review

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { chromium } from '../node_modules/playwright/index.mjs';

const here = import.meta.dirname;
const out = path.join(here, 'out');
fs.mkdirSync(path.join(out, 'stills'), { recursive: true });
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; };
const FPS = 30;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`file://${path.join(here, 'intro.html')}`);
await page.evaluate(() => document.fonts.ready);
const { duration, cues, keyTimes } = await page.evaluate(() => ({ duration: window.DURATION, cues: window.CUES, keyTimes: window.KEY_TIMES }));
const frameAt = async t => { await page.evaluate(x => window.render(x), t); return page.screenshot({ type: 'png' }); };

if (process.argv.includes('--stills')) {
  const list = (arg('stills', '') && !arg('stills', '').startsWith('--') ? arg('stills').split(',').map(Number) : keyTimes);
  for (const t of list) {
    const file = path.join(out, 'stills', `t${t.toFixed(2).padStart(6, '0')}.png`);
    fs.writeFileSync(file, await frameAt(t));
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

const from = Number(arg('from', 0));
const to = Math.min(Number(arg('to', duration)), duration);
const partial = from > 0 || to < duration;
const silent = path.join(out, partial ? 'part-silent.mp4' : 'video-silent.mp4');
const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
const frames = Math.round((to - from) * FPS);
const started = Date.now();
for (let i = 0; i < frames; i++) {
  const png = await frameAt(from + i / FPS);
  if (!enc.stdin.write(png)) await new Promise(r => enc.stdin.once('drain', r));
  if (i % 150 === 0) console.log(`frame ${i}/${frames} (${Math.round((Date.now() - started) / 1000)} s)`);
}
enc.stdin.end();
await new Promise((resolve, reject) => enc.on('close', code => (code ? reject(new Error(`ffmpeg exited ${code}`)) : resolve())));
await browser.close();

// ---- Sound effects, synthesized from the cue list ------------------------------------
const RATE = 48000;
const mix = new Float32Array(Math.ceil((to - from + 0.5) * RATE));
const noise = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return (s / 2147483647) * 2 - 1; }; })();
function add(at, len, fn) {
  const start = Math.round((at - from) * RATE);
  for (let i = 0; i < len * RATE; i++) { const j = start + i; if (j >= 0 && j < mix.length) mix[j] += fn(i / RATE); }
}
const env = (t, attack, decay) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));
const SOUNDS = {
  click: (at, v = 1) => add(at, 0.05, t => v * 0.5 * env(t, 0.001, 0.006) * (noise() * 0.6 + Math.sin(2 * Math.PI * 2600 * t) * 0.4)),
  key: (at, v = 1) => add(at, 0.03, t => v * 0.16 * env(t, 0.0008, 0.004) * (noise() * 0.7 + Math.sin(2 * Math.PI * 3400 * t) * 0.3)),
  tick: (at, v = 1) => add(at, 0.12, t => v * 0.32 * env(t, 0.002, 0.03) * Math.sin(2 * Math.PI * 1760 * t)),
  pop: (at, v = 1) => add(at, 0.16, t => v * 0.5 * env(t, 0.003, 0.05) * Math.sin(2 * Math.PI * (320 + 1400 * t) * t)),
  thud: (at, v = 1) => add(at, 0.3, t => v * 0.7 * env(t, 0.002, 0.08) * Math.sin(2 * Math.PI * (90 - 40 * t) * t)),
  whoosh: (at, v = 1) => { let lp = 0; add(at, 0.45, t => { lp += (noise() - lp) * (0.02 + 0.25 * Math.sin(Math.PI * t / 0.45)); return v * 0.5 * Math.sin(Math.PI * t / 0.45) ** 2 * lp; }); },
  fold: (at, v = 1) => { let lp = 0; add(at, 0.22, t => { lp += (noise() - lp) * 0.3; return v * 0.35 * env(t, 0.01, 0.05) * lp; }); },
  chime: (at, v = 1) => add(at, 1.4, t => v * 0.22 * env(t, 0.004, 0.45) * (Math.sin(2 * Math.PI * 880 * t) + 0.6 * Math.sin(2 * Math.PI * 1318.5 * t) + 0.3 * Math.sin(2 * Math.PI * 1760 * t))),
  rise: (at, v = 1) => add(at, 0.9, t => v * 0.16 * Math.sin(Math.PI * t / 0.9) * (Math.sin(2 * Math.PI * (440 + 440 * t) * t) + 0.5 * Math.sin(2 * Math.PI * (660 + 660 * t) * t))),
  alert: (at, v = 1) => add(at, 0.35, t => v * 0.22 * env(t, 0.003, 0.1) * (Math.sin(2 * Math.PI * 520 * t) + Math.sin(2 * Math.PI * 554 * t))),
};
for (const c of cues) if (c.t >= from && c.t < to) SOUNDS[c.sound]?.(c.t, c.v ?? 1);
const peak = mix.reduce((m, x) => Math.max(m, Math.abs(x)), 0.0001);
const gain = Math.min(1, 0.7 / peak);
const wav = Buffer.alloc(44 + mix.length * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + mix.length * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(mix.length * 2, 40);
mix.forEach((x, i) => wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x * gain * 32767))), 44 + i * 2));
const sfx = path.join(out, 'sfx.wav');
fs.writeFileSync(sfx, wav);

const final = path.join(out, partial ? 'part.mp4' : 'mo-intro.mp4');
await new Promise((resolve, reject) => spawn(ffmpeg, ['-y', '-loglevel', 'error', '-i', silent, '-i', sfx, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', final], { stdio: 'inherit' })
  .on('close', code => (code ? reject(new Error(`ffmpeg exited ${code}`)) : resolve())));
console.log(`${final} (${frames} frames, ${Math.round((Date.now() - started) / 1000)} s)`);
