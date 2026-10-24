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
mixes it well under the effects and the voice, and ducks it further whenever the narrator speaks.
