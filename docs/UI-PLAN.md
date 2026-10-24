# Show Me — UI plan: mascot, voice hotkey, and making Mubit visible

> **Renamed:** this project is now called **Mo** (24 Oct 2026). It grew from "Show Me", the browser agent you teach by hand, into an assistant that helps and keeps you safe. This document is kept as written at the time; see the [README](../README.md) for what Mo is today.

Written 24 Oct 2026, before the Sunday 10:00 demo. **Status: built** (items 1–5); the optional 3D Mo (item 6) is not. How to use it: [TESTING.md](../TESTING.md).

Three goals:

1. **A mascot on every page**: small, playful, lives in a corner, shows what the agent is doing.
2. **A hotkey to talk**: press it, a live waveform shows it's listening, then it does what you said.
3. **Judges can see Mubit working, live**: every call, every correction becoming training data,
   failures turning into improvements, and the savings.

None of this touches the system prompts, so the Mubit tasks we've already seeded keep counting.

---

## 1. The mascot ("Mo")

### What it looks like and does

A small round character (about 56 px), an orb with eyes, in a corner of every page. It reacts to the
agent's state:

| State | What Mo does | When |
| --- | --- | --- |
| Idle | Bobs, blinks, sometimes wanders a little along the bottom edge or peeks over a corner | Nothing running |
| Listening | Wakes up, glows; a waveform pill opens beside it with your words appearing live | Hotkey pressed or Mo clicked |
| Thinking | Spinning dots above its head | Waiting for Claude via Mubit |
| Acting | Floats to the element the agent is about to click and points at it, then returns | Each click / type |
| Stuck | Tilts its head; a "?" bubble says "Can you show me?" | Run failed or `ask_human` |
| Learning | Scribbles in a notebook; "+5 → Mubit" cards fly from Mo toward the corner | Demonstration saved and sent |
| Success | Little jump and sparkle | Done-check passes |

Clicking Mo opens a mini menu: **Talk**, **Open panel**, **Hide on this site**. Mo can be dragged to any
corner and remembers it. It hides when the page is fullscreen (videos).

### How to build it (recommendation: SVG, not three.js on every page)

| Option | Cost per tab | Look | Verdict |
| --- | --- | --- | --- |
| **SVG + CSS / Web Animations** in a Shadow DOM | ~10 KB, no WebGL | Flat, cute, crisp | **Use this on pages** |
| three.js 3D character | ~600 KB script + a WebGL context per tab; Chrome caps live WebGL contexts, so many tabs break | Impressive | **Only inside the side panel** (one copy) as a 3D "hero" Mo, if time allows |
| Lottie / Rive animation | 60–250 KB player | Rich, needs an animator | Later |

- The content script injects Mo into a **closed Shadow DOM**, so the website's CSS can't break it and Mo
  can't break the site.
- Mo never covers what the agent needs: it moves out of the way of the element being clicked, and it is
  invisible to the agent's page snapshot (it lives outside `document` queries in a shadow root).
- `prefers-reduced-motion` turns the wandering off.

## 2. Voice hotkey with a live waveform

### The hotkey

- **The Fn / Globe key can't be used.** macOS keeps it for itself (dictation, emoji) and Chrome never
  receives it.
- Use Chrome's extension shortcuts (`chrome.commands`). Default **⌥ Space** (Option + Space); you can
  change it at `chrome://extensions/shortcuts`.
- Press once to start listening; it stops by itself when you stop talking. Press again to cancel.
  Clicking Mo does the same.

### How listening works, and why the side panel opens

Chrome only lets an extension use the microphone from a visible extension page, and the agent loop
runs in the side panel. So:

```
⌥Space ─► background ─► opens the side panel (allowed: a shortcut counts as a user action)
                         └► side panel starts speech recognition + reads mic levels
                              └► sends levels and live words to the page ─► Mo shows the waveform pill
                                                                           with the transcript
         you stop talking ─► final words become the goal ─► agent runs ─► Mo narrates each step
```

- The **waveform** is real: about 20 updates a second of microphone loudness drawn as bars in the pill
  next to Mo, like a voice note recording.
- **Talk back** stays on: Mo says "On it", "Can you show me?", "Done".
- **Fallbacks:** typing in the panel; Wispr Flow dictation into the goal box.
- One-time setup: the first time, the panel asks for the microphone in a normal tab (Chrome requires it).

## 3. Making Mubit visible: the side panel redesign

The judges score four things equally: **Use of Mubit**, **Usefulness**, **Technical execution**, **Demo**.
Use of Mubit is scored on *a correction turning into a model update in your demo*, and the track asks for
*quality, cost and latency side by side*. The panel should prove each of these live, not on a slide.

### New layout: three tabs

```
┌───────────────────────────────┐
│ ◉ Mo   Claude Haiku via Mubit ●│  ← live dot pulses on every Mubit call
│ [ Agent ] [ Mubit ] [ Judges ] │
├───────────────────────────────┤
```

#### Tab 1 — Agent (what you have today, tidied)

Goal box with mic, the live timeline with costs, the red **mistake** marker after teaching, and the
"Show me how" card.

#### Tab 2 — Mubit (the visual proof)

Wireframe (the numbers are examples):

```
 Browser ──► Show Me ──► Mubit gateway ──► Claude
    ● ● ●  packets animate along the line on every call
                     └──► Training examples  [+5]  (demonstrations drop in here)

 LIVE CALLS                                  task         ms     $       request
 ▸ next-action   click "Sitting C"          next-action  982   0.0010  mreq_01a1…
 ▸ done-check    goal met                   done-check   840   0.0008  mreq_01a1…
 ▸ TRAINING      taught step 3 of 5         next-action  —     0.0009  mreq_01a1…

 TASKS → ADAPTERS          sent   kept (console)   status
 next-action  ◔ 53/25      ✓      28 of 25         Training → v1
 done-check   ◔ 35/25      ✓      25 of 25         v1 Passed · matched 92%

 CORRECTIONS → MODEL UPDATES
 23:58  "Book a table…"  taught 5 steps → 5 training examples → next-action v2 (after reset)

 FAILURES → IMPROVEMENTS
 Book a table for two at eight   ✗ ✗ ✓ ✓ ✓    fixed after 1 lesson
 Play a Burna Boy video          ✓ ✓

 COST & SPEED (per 1,000 decisions)
 Claude via Mubit   $0.98   1,260 ms
 Adapter            $0.05   ~200 ms   (estimate; paste real Try models numbers ✎)
 At 50k decisions/day: $1,470 → $74 a month
```

- **Live calls**: every call appears as it happens, with its Mubit request ID (copyable), so a judge can
  find the same call in Mubit → Requests.
- **Training rows** are highlighted: those are corrections turning into examples.
- **Kept examples and adapter status** come from Mubit's console, which has no public API. Plan:
  the **Mubit bridge**, a read-only content script on `app.mubit.ai` that reads the Tasks and Adapters
  pages while you have the console open in a tab and sends the numbers to the panel (for example
  "12 of 25 examples", "v1 Passed · matched 92%"). Without the console open, the panel shows our own
  counts, labelled as ours. This is the riskiest piece: it depends on the console's page layout.
- **Failures → improvements**: each goal's run history as ✗/✓ marks, showing the lesson that fixed it.
- **Cost & speed**: our real per-call costs next to the adapter. A small form takes the real ratio from
  Try models, so the numbers stop being estimates.

#### Tab 3 — Judges (pitch mode)

One card per criterion. Each item ticks itself when the evidence happens in the session:

| Criterion | Live evidence that ticks |
| --- | --- |
| **Use of Mubit** | Calls through Mubit (count) · a demonstration sent as training examples · a task reached 25 kept · an adapter version passed (from the bridge) |
| **Usefulness** | Goals completed on real sites (e.g. YouTube) · a failure fixed by one lesson · projected monthly saving |
| **Technical execution** | Tools used this session (open_url, type + Enter…) · error-free decision rate · 58 automated tests · garbled answers recovered |
| **Demo** | A 3-minute scene tracker with a timer: Voice command → Fail → Teach → Rerun → Ledger |

A **Present** button enlarges the panel's text and Mo, for the projector.

## 4. Design system

- **Astryx** (Meta's open-source design system, MIT, public beta since late June 2026) is React 19 +
  StyleX. Our panel and in-page overlay are plain JavaScript, and the overlay must stay tiny and isolated
  inside each website.
  - **Recommendation:** adopt Astryx's *token model* rather than its React components. Generate the
    palette from **one accent colour** with light and dark pairs, and derive type sizes from a base size
    and scale ratio. Use a base radius times a multiplier, and fast/medium motion durations. These become
    CSS variables shared by the panel, Mo and the overlays.
  - **Later:** move the side panel to React + Astryx components (build step with Vite) after the
    hackathon. Not worth the risk before Sunday, since the APIs are still in beta.
- **"Muse"**: several products share the name. If you meant Ink & Switch's Muse, the idea to borrow is
  calm, fluid motion and a canvas feel: soft easing and nothing jumpy. Tell me which Muse you meant, and
  I'll pull its specifics.
- **Accent**: Show Me orange `#ff5a1f`. Mubit-related UI uses one consistent secondary colour, so "this
  is Mubit" reads at a glance across Mo, the packets and the cards.

## 5. Build order (fits before Sunday 10:00)

| # | Piece | Est. | Why this order |
| --- | --- | --- | --- |
| 1 | Mubit tab: live calls, flow animation, cost & speed, failures → improvements | 3 h | Directly scored ("show Mubit being used") |
| 2 | Voice hotkey + waveform pill (in panel first, then on page) | 2 h | The demo opening |
| 3 | Mo on every page: idle, listening, thinking, acting, stuck, learning, success | 3 h | Demo wow; reuses state events from 1–2 |
| 4 | Judges tab with auto-ticking evidence + Present mode | 1.5 h | Makes the scoring obvious |
| 5 | Mubit bridge (read console Tasks/Adapters) | 1.5 h | Real kept/adapter numbers; riskiest, so last |
| 6 | Optional 3D Mo in the panel header (three.js) | 1.5 h | Only if time is left |

Tests: each piece gets Playwright checks like the existing suite (the hotkey via `chrome.commands`,
the waveform via a fake microphone stream, Mo's states via scripted runs).

## 6. Risks and how we handle them

- **Speech recognition needs internet** (Chrome sends audio to Google). Keep typing and Wispr Flow as fallbacks.
- **Mubit bridge breaks if the console's layout changes**: it fails quietly back to our own counts.
- **Mo on busy sites**: closed Shadow DOM, highest z-index, auto-hides in fullscreen, per-site hide.
- **Projector readability**: Present mode, high-contrast tokens.

## Sources

- Astryx coverage: [OpenReplay first look](https://blog.openreplay.com/first-look-astryx-meta-design-system/),
  [Better Stack guide](https://betterstack.com/community/guides/ai/astryx-meta-design-system/),
  [Design Compass](https://designcompass.org/en/2026/07/06/meta-open-sources-astryx-design-system/)
- Muse (Ink & Switch): [Tenfold: 10 years of Ink & Switch](https://www.inkandswitch.com/muse/)
- Microphone in extensions: [Chrome extension samples discussion](https://github.com/GoogleChrome/chrome-extensions-samples/issues/821),
  [freeCodeCamp: mic permissions in extensions](https://www.freecodecamp.org/news/handling-mic-input-permissions-and-speech-recognition-in-chrome-extensions-ff7e3ca84cb0/)
