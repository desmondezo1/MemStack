# Mo's films

- **Sarah and Mo** (96 s, `out/sarah-and-mo.mp4`): the story film. Sarah, a Customer Success Associate, her morning,
  her Monday grind, Mo, and what changes. Built from `story.html` and `sarah.js` (the character).
- **Introducing Mo** (60 s, `out/mo-intro.mp4`): the first, shorter product film, from `intro.html`.

## Sarah and Mo

```bash
node render.js --page story.html   # frames → out/story-silent.mp4 and out/story-sfx.wav (about 8 minutes)
node music.js --story              # the score → out/story-music.wav
node voice.js --story              # narration + music + effects → out/sarah-and-mo.mp4
node render.js --page sheet.html --stills 0   # Sarah's character sheet
```

| Time | Scene | Narration |
| --- | --- | --- |
| 0 to 17 s | Her life: kitchen at sunrise, the bus, a happy customer call | This is Sarah. She works in customer success… Helping customers is why she took the job. |
| 17 to 34 s | Monday, 8:58, from behind at her desk: the email, then the grind (clock races, coffee empties, head in hand, a contract to check) | But every Monday, Sales sends her this. Forty-seven new customers. Twelve clicks each. |
| 34 to 42 s | Mo pops up on her screen; the camera dives into the monitor | Then she tried Mo. |
| 42 to 55 s | She does row 1, with notes for the renewal date and blank owners; it becomes a skill | She shows Mo one row, and leaves a note where the sheet doesn't say. |
| 55 to 70 s | Mo does the rest: "Ent" → Enterprise, a blank owner follows her note, a bad email gets "needs a look"; 46 created, 1 to check | Then Mo does the rest… Mo doesn't guess. It asks. |
| 70 to 77.6 s | The camera pulls back: 9:14, coffee in hand; then back on a call | Forty-seven customers, before her coffee's gone cold. |
| 77.6 to 89 s | Mubit trains a smaller model on her lessons; the cost of her Monday run falls (estimate) | Every lesson goes through Mubit… faster, and a fraction of the cost. |
| 89 to 96 s | Sarah and Mo: "Mo. Show it once." | Mo. Show it once. |

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
