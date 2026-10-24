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
```

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
cuts happen on Mo's blink; orange is the only colour that moves. Music isn't included: add a track in the edit.
