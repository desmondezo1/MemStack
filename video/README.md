# Mo's films

- **Sarah and Mo** (105 s, `out/sarah-and-mo.mp4`): the story film. Sarah, a Customer Success Associate, her morning,
  her Monday grind, Mo, and what changes. Built from `story.html` and `sarah.js` (the character).
- **Introducing Mo** (60 s, `out/mo-intro.mp4`): the first, shorter product film, from `intro.html`.

## Sarah and Mo

```bash
node render.js --page story.html   # frames → out/story-silent.mp4 and out/story-sfx.wav (about 8 minutes)
node music.js --story              # the score → out/story-music.wav
node voice.js --story              # narration + music + effects → out/sarah-and-mo.mp4
node render.js --page sheet.html --stills 0   # Sarah's character sheet
```

Narration is plain English, written so anyone can follow it without knowing what customer success is.

| Time | Scene | Narration |
| --- | --- | --- |
| 0 to 17 s | Her life: kitchen at sunrise, the bus, a happy customer call | This is Sarah. Her job is looking after the company's new customers. Helping people is the part of the job she loves. |
| 17 to 23 s | Monday, 8:58, from behind at her desk; her screen labelled "Spreadsheet from Sales" and "Support system" | But every Monday, the sales team emails her a spreadsheet: every customer who signed up last week. |
| 23 to 29 s | **The task, explained:** one customer copied from the spreadsheet into the support system by hand, then the next, × 47 | Each one has to be typed into the support system by hand, so the team can help them. |
| 29 to 40 s | The grind: the clock races, coffee empties, head in hand, a messy row to check | Forty-seven customers. Copy, paste, check, save. Over and over. And some rows are messy… |
| 40 to 48 s | Mo pops up on her screen; the camera dives into the monitor | Then she tried Mo: an assistant in her browser that she can teach by showing it once. |
| 48 to 61 s | She fills in the first customer, with notes for the renewal date and blank owners; it becomes a skill | She fills in the first customer herself while Mo watches… Mo saves it as a skill. |
| 61 to 76 s | Mo does the other 46: "Ent" → Enterprise, a blank owner follows her note, a broken email is flagged | "Ent"? Mo knows that means Enterprise. No owner? It follows her note. And when an email address is broken, Mo doesn't guess. It asks Sarah to check. |
| 76 to 83.6 s | The camera pulls back: 9:14, coffee in hand; then back on a call | All forty-seven, done before her coffee's gone cold. And she's back to the part of the job she loves. |
| 83.6 to 98 s | Mubit sees every step and trains a smaller, cheaper AI; the cost of her Monday task falls (estimate) | Behind the scenes, every step Mo takes goes through Mubit… So her Monday task gets faster, and cheaper, every week. |
| 98 to 105 s | Sarah and Mo: "Mo. Show it once." | Mo. Show it once. |

# Introducing Mo: the 60-second film

Every frame is drawn by `intro.html` and captured by `render.js`: no screen recording, no video editor.
`window.render(t)` draws the frame at `t` seconds, so a frame is the same however slow the machine is.
Playwright's Chromium takes each frame, ffmpeg (bundled through `ffmpeg-static`) encodes it, and the sound
effects are synthesized from the page's cue list and mixed in.

```bash
cd video
npm install
node render.js --stills          # a still for each key moment, in out/stills/
node render.js --from 13 --to 27 # just one part, as out/part.mp4
node render.js                   # the whole film: out/mo-intro.mp4 (1920×1080, 30 fps, about 5 minutes)
node music.js                    # compose the music bed: out/music.wav
node voice.js                    # then mix voiceover, music and effects (Fish Audio; needs FISH_API_KEY in .env)
```

## Voiceover

`voice.js` records each line with Fish Audio (`s2.1-pro-free`, the "Documentary" narrator voice), with direction
cues such as `[warm, slightly amused]` and `[break]`. Lines are cached in `out/voice/`, trimmed, placed at their
caption's time (sped up by at most 12% if a line would overrun the next), and mixed over the sound effects, which dip
under the voice. The mix is levelled to -16 LUFS. `node voice.js --check` reports how each line fits without mixing.

## The story (60 s)

| Time | Beat | Line |
| --- | --- | --- |
| 0 to 7 s | **Again**: the same form, faster and faster, Row 1 → 212 | Every week. The same clicks. |
| 7 to 13 s | **Meet Mo**: drops in, lands, opens its eyes | Mo. Do it once. Mo does the rest. |
| 13 to 27 s | **Show it once**: row 1 by hand, lines from the sheet to the form, a note on the start date, it folds into a skill; she presses Run | Show it once. Add a note where it needs one. Now it's a skill. Next Monday, she presses Run. |
| 27 to 40 s | **It keeps doing it**: rows 2 to 10 fly into the form, "Eng" → Engineering, blank → Operations | Then it keeps doing it. Ten starters. One row of effort. |
| 40 to 50 s | **Gets better**: one correction, then lesson steps flow through Mubit into a smaller model | Not quite right? Fix it once. It learns your way. Every lesson trains a smaller model, through Mubit. |
| 50 to 60 s | **End**: four skills, a fake "unsubscribe" email flagged, Mo | Your weekly work, taught once. And it watches your back. Mo. Show it once. |

Motion rules: one spring curve for everything (a small overshoot, then settle); one moving thing at a time;
cuts happen on Mo's blink; orange is the only colour that moves. 

## Music

`music.js` composes the bed to the film's timing, in D major at 100 BPM: silent while the clicks build; a warm chord
when Mo lands (7.4 s); a soft pulse and arpeggio while Ada teaches; a lift with hats while Mo does the rows; a drop for
the correction (40 s); a build as lessons flow into Mubit; a beat of silence (55.6 s); and a final Dmaj9 chord with a
bell under "Mo. Show it once." Pads, bass, mallets and drums are synthesized and given a small reverb. `voice.js`
mixes it as a background bed, about 15 dB under the voice, and ducks it further whenever the narrator speaks. One fixed gain,
measured in a first pass, brings the whole mix to -16 LUFS without lifting the quiet music back up.
