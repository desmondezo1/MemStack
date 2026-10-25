// The film's voiceover, from Fish Audio. Each line is recorded once (cached by its text and
// voice), placed at its caption's time, and mixed over the sound effects, which dip under the
// voice. Needs FISH_API_KEY in the repo's .env, and a render first (out/video-silent.mp4, out/sfx.wav).
//
//   node voice.js          # out/mo-intro.mp4 with the voiceover
//   node voice.js --story  # the Sarah film: out/sarah-and-mo.mp4 (render story.html and music.js --story first)
//   node voice.js --check  # record the lines and report how each fits, without mixing

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { loadEnv } from '../server/env.js';

loadEnv();
const here = import.meta.dirname;
const out = path.join(here, 'out');
const cache = path.join(out, 'voice');
fs.mkdirSync(cache, { recursive: true });

const VOICE = 'c3958f083c2d407982263c77cfa831e3'; // Fish Audio "Documentary": deep, older male narrator
const MODEL = 's2.1-pro-free';
const STORY = process.argv.includes('--story');
// The Sarah film: starts match the subtitles in story.html.
const STORY_LINES = [
  [0.7, '[warm] This is Sarah.'],
  [5.9, '[warm] Her job is looking after the company\'s new customers.'],
  [10.9, '[warm, fond] Helping people is the part of the job she loves.'],
  [17.2, 'But every Monday, the sales team emails her a spreadsheet: [break] every customer who signed up last week.'],
  [23.4, 'Each one has to be typed into the support system by hand, so the team can help them.'],
  [29.4, '[a little weary] Forty-seven customers. [break] Copy, paste, check, save. [break] Over and over.'],
  [34.2, '[weary] And some rows are messy, so she has to stop and check.'],
  [40.4, '[brightening] Then she tried Mo: an assistant in her browser that she can teach by showing it once.'],
  [48.4, '[confident] She fills in the first customer herself while Mo watches. Where the spreadsheet doesn\'t have the answer, she adds a note.'],
  [57.6, '[pleased] Mo saves it as a skill: a task it now knows how to do.'],
  [61.4, '[confident] Then Mo does the other forty-six.'],
  [64.0, '"Ent"? Mo knows that means Enterprise.'],
  [66.7, 'No owner? It follows her note.'],
  [69.1, '[measured] And when an email address is broken, Mo doesn\'t guess. [break] It asks Sarah to check.'],
  [76.6, '[warm, satisfied] All forty-seven, done before her coffee\'s gone cold.'],
  [80.4, '[warm] And she\'s back to the part of the job she loves.'],
  [83.8, 'Behind the scenes, every step Mo takes goes through Mubit.'],
  [87.4, 'Mubit learns from Sarah\'s lessons, and trains a smaller, cheaper AI to do the same task.'],
  [92.6, '[confident] So her Monday task gets faster, and cheaper, every week.'],
  [99.4, '[warm, confident] Mo. [break] Show it once.'],
];
// [start in seconds, text with Fish Audio s2 cues]. Starts match the captions in intro.html.
const INTRO_LINES = [
  [1.0, '[warm, slightly amused] Every week. [break] The same clicks.'],
  [9.95, '[warm] Meet Mo. [break] Do it once, and Mo does the rest.'],
  [13.6, '[confident] Show it once.'],
  [18.6, '[gentle] Add a note where it needs one.'],
  [21.35, '[pleased] Now it\'s a skill.'],
  [25.4, 'Next Monday, she presses Run.'],
  [27.8, '[confident] Then it keeps doing it.'],
  [37.15, 'Ten starters. [emphasis] One row of effort.'],
  [40.6, 'Not quite right? [break] Fix it once.'],
  [42.8, '[warm] It learns your way.'],
  [44.35, 'Every lesson trains a smaller model, through Mubit.'],
  [50.45, 'Your weekly work, taught once.'],
  [53.65, '[slightly playful] And it watches your back.'],
  [56.3, '[warm, confident] Mo. [break] Show it once.'],
];
const LINES = STORY ? STORY_LINES : INTRO_LINES;

function duration(file) {
  const info = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const m = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function record(text) {
  const file = path.join(cache, `${crypto.createHash('sha1').update(`${VOICE}|${MODEL}|${text}`).digest('hex').slice(0, 12)}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  if (!process.env.FISH_API_KEY) throw new Error('Set FISH_API_KEY in .env first.');
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.FISH_API_KEY}`, 'content-type': 'application/json', model: MODEL },
      body: JSON.stringify({ text, reference_id: VOICE, format: 'mp3', mp3_bitrate: 192, latency: 'normal', normalize: true }),
    });
    if (res.ok) { fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); return file; }
    if (res.status !== 429 && res.status < 500) throw new Error(`Fish Audio ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error('Fish Audio kept refusing (rate limit).');
}

// Recorded speech has a little silence at each end: trim it so lines start on their cue.
function trimmed(file) {
  const t = file.replace(/\.mp3$/, '.trim.wav');
  if (!fs.existsSync(t)) {
    spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', file, '-af',
      'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse',
      '-ar', '48000', '-ac', '1', t]);
  }
  return t;
}

const takes = [];
for (const [at, text] of LINES) {
  const file = trimmed(await record(text));
  takes.push({ at, text, file, len: duration(file) });
}
// Each line has to finish before the next one starts; a line that's too long is sped up a
// little (at most 12%), and anything beyond that is reported.
const END = STORY ? 105 : 60;
takes.forEach((tk, i) => {
  const room = (takes[i + 1]?.at ?? END - 0.3) - tk.at - 0.2;
  tk.tempo = tk.len > room ? Math.min(1.12, tk.len / room) : 1;
  const fits = tk.len / tk.tempo <= room + 0.01;
  console.log(`${tk.at.toFixed(2).padStart(6)}s  ${tk.len.toFixed(2)}s of ${room.toFixed(2)}s${tk.tempo > 1 ? `, sped up ${Math.round((tk.tempo - 1) * 100)}%` : ''}${fits ? '' : '  ✗ STILL TOO LONG'}  ${tk.text}`);
});
if (process.argv.includes('--check')) process.exit(0);

// Mix: the voice lines at their times; the effects dip under the voice (sidechain); the music
// sits far below everything (a background bed, about 15 dB under the voice) and dips again under it.
// Then one fixed gain for the whole mix, measured in a first pass, brings it to -16 LUFS. (An
// automatic leveller would lift the quiet music back up between lines.)
const silent = path.join(out, STORY ? 'story-silent.mp4' : 'video-silent.mp4');
const sfx = path.join(out, STORY ? 'story-sfx.wav' : 'sfx.wav');
const music = path.join(out, STORY ? 'story-music.wav' : 'music.wav'); // from music.js; mixed in when it's there
if (!fs.existsSync(silent) || !fs.existsSync(sfx)) throw new Error('Run node render.js first.');
const withMusic = fs.existsSync(music);
const MUSIC_DB = -28;
const first = withMusic ? 2 : 1;
const inputs = ['-i', sfx, ...(withMusic ? ['-i', music] : []), ...takes.flatMap(tk => ['-i', tk.file])];
const placed = takes.map((tk, i) => `[${i + first}:a]${tk.tempo > 1 ? `atempo=${tk.tempo.toFixed(3)},` : ''}adelay=${Math.round(tk.at * 1000)}:all=1[v${i}]`);
const filter = [
  ...placed,
  `${takes.map((_, i) => `[v${i}]`).join('')}amix=inputs=${takes.length}:normalize=0,apad=whole_dur=${END},aformat=channel_layouts=stereo[vo]`,
  `[vo]asplit=${withMusic ? 3 : 2}[vo1][vo2]${withMusic ? '[vo3]' : ''}`,
  '[0:a]volume=0.8,aformat=channel_layouts=stereo[fx]',
  '[fx][vo1]sidechaincompress=threshold=0.03:ratio=5:attack=15:release=350[duck]',
  ...(withMusic ? [`[1:a]volume=${MUSIC_DB}dB[mus]`, '[mus][vo3]sidechaincompress=threshold=0.01:ratio=10:attack=50:release=800[mduck]'] : []),
  `[duck]${withMusic ? '[mduck]' : ''}[vo2]amix=inputs=${withMusic ? 3 : 2}:normalize=0[mix]`,
].join(';');
const raw = path.join(out, STORY ? 'story-mix-raw.wav' : 'mix-raw.wav');
let r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[mix]', '-t', String(END), '-ar', '48000', raw], { stdio: 'inherit' });
if (r.status) process.exit(r.status);
const measured = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', raw, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const loud = Number([...measured.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop()?.[1] ?? -16);
const gain = (-16 - loud).toFixed(2);
const final = path.join(out, STORY ? 'sarah-and-mo.mp4' : 'mo-intro.mp4');
r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', silent, '-i', raw, '-filter_complex', `[1:a]volume=${gain}dB,alimiter=limit=0.6:attack=1:release=60:level=false[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(END), final], { stdio: 'inherit' });
if (r.status) process.exit(r.status);
console.log(`${final}: voiceover mixed (${takes.length} lines, voice ${VOICE})${withMusic ? `, music bed at ${MUSIC_DB} dB` : ''}, gain ${gain} dB`);
