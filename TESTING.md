# Test Show Me locally

About 10 minutes. You need Node 20.11+ and Google Chrome.

## 1. Start the backend

```bash
cd MemStack
npm install        # only installs Playwright, for the automated tests
npm start
```

You should see `Show Me server on http://localhost:8787 · MOCK model (no MUBIT_API_KEY set)`.
Leave it running.

## 2. Load the extension

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `MemStack/extension` folder. (Already loaded? Press the
   reload icon on its card: new versions add files and the ⌥Space shortcut.)
3. Pin **Show Me** from the puzzle-piece menu.

After any change to files in `extension/`, press the reload icon on the Show Me card.

## 3. Run the demo offline (mock model)

1. Open <http://localhost:8787/demo/> (Trattoria Nove).
2. Click the **Show Me** icon. The side panel opens; the pill says **Mock model (no Mubit key)**.
3. Type `Book a table for two at eight` (or press the mic and say it) and press **Run**.
4. Watch it dismiss the popup, pick a party size, **guess Sitting A**, book, and fail the check:
   *Booked, but not at 20:00*.
5. Press **Show me how**. The page reloads with an orange "Show Me is watching" badge. Do it yourself:
   **No thanks** → Party size **2** → **Sitting C** (hover shows 20:00) → type a name → **Reserve table**.
   Each step appears in the panel.
6. Press **Done teaching**. The panel says how many steps were saved and sent for training.
7. Press **Run it again**. Every step is tagged **from lesson** and it ends **Done ✓** at Sitting C (20:00).
8. Open the **Ledger** tab to see live vs taught calls per task.

**Forget lessons** (bottom of the Agent tab) clears memory, so you can rehearse again.

### What the agent can do

| Tool | What it does |
| --- | --- |
| `open_url` | Opens a site, or goes straight to a search results URL. Works from a new tab. |
| `click`, `type`, `select` | Acts on a button, link, field or dropdown. `type` can press Enter afterwards (search boxes). |
| `press` | Enter, Escape, Tab, arrow keys. |
| `back`, `scroll`, `wait` | Goes back a page, reveals more of a long page, waits for a slow page. |
| `ask_human` | The agent says it's stuck and asks you to show it (spoken aloud with **Talk back** on). |
| `done` | Finishes; a separate check then reads the page to confirm the goal really happened. |

Try, from any tab (even a new tab):

- `Open YouTube and play a Burna Boy video`: real YouTube, so it needs the real model (step 4 below).
- `open http://localhost:8787/demo/tube/ and play a Burna Boy video`: **Tubely**, an offline copy of a
  video site for a stage demo that can't break. Works with the mock too.

### Mo, the mascot

Mo is the orange orb in the bottom-right corner of every page. It bobs and wanders when idle. It shows
dots while Claude is thinking, floats to whatever the agent is about to click, and asks *"Can you show
me?"* when stuck. When a lesson is sent it throws **+1 → Mubit** cards, and it jumps when it's done.

- **Hold Mo** (or hold ⌥ Space) to talk, let go to run. A quick click just reminds you to hold.
- **Right-click Mo** (or ⋯ on hover) for its menu: *Open the Show Me panel*, *How to talk to me*,
  *Hide on this site*. The panel only ever opens from this menu.
- When it asks for help, clicking its bubble opens the menu with **Teach me (opens the panel)** on top.
- **New tabs** show Show Me's own New Tab page (a search box, the talk hint, and Mo), because Chrome's
  built-in one can't run extensions. Chrome asks once whether to keep it.

### Asking questions

Ask a question instead of giving a task, e.g. *"What time do they open on Sunday?"* on the demo
restaurant. Show Me finds the part of the page that answers it, scrolls there, and draws a box around
it with the answer. Mo says the answer too. If the answer isn't on the page, it navigates first. If it
can't find it, it asks you to show it: go to the page and **select the answer text**.

### Teaching ("Show me how")

- Every step you take flashes on the page (*Recorded: click*), and appears in the panel with its site.
  Click **×** on any step to remove it.
- **New tabs and tab switches** are recorded, and the recorder follows you to the new tab.
- **Selecting text** records "this is the answer" (for questions).
- When you press **Done**, Show Me checks the lesson for detours, using simple rules and the model
  through Mubit. A result you opened and then came back from, typing you corrected, and opening a tab
  are suggested for removal. You review them (*Check your lesson*), and only the ticked steps are
  taught. If nothing looks unneeded, it saves straight away.

### Reading the side panel

Three tabs: **Agent**, **Mubit**, **Judges**. The ⤢ button is Present mode (bigger text for a projector).
The small dot next to the model name flashes purple on every Mubit call.

**Agent tab**

- **Timeline**: every decision with its reason, time, cost on Claude, and the page it led to (`now on …`).
- **Green strip**: live savings: this run's calls through Mubit, cost on Claude vs on an adapter, and
  latency, plus the all-time total.
- **Mistake view**: after you teach, the step where the agent went wrong turns red: *"Mistake at step 3:
  I did click Sitting D, you did click Sitting C."*
- When you teach, typing an address in the address bar is recorded too (as `open …`), and so is
  typing in a search box and pressing Enter.

**Mubit tab** (the proof that Mubit is used)

- **Flow diagram**: a dot travels Browser → Show Me → Mubit → Claude on every call. Taught steps drop
  into the purple **examples** box.
- **Live calls**: every call as it happens: task, what was decided, time, cost and the Mubit request
  ID. Click an ID to copy it and find the same call in Mubit → Requests. Taught steps are marked
  **training**.
- **Tasks → adapters**: calls sent per task. **Kept** and **Mubit status** fill in by themselves while
  Mubit's console is open in another tab (Tasks page). A read-only reader (the Mubit bridge) picks them up.
- **Corrections → model updates**: each lesson, and how many training examples it sent through Mubit.
- **Failures → improvements**: each goal's history (✗ ✗ ✓), and whether a lesson fixed it.
- **Cost & speed**: Claude vs adapter per 1,000 decisions and per month at 50k a day. Once you've compared
  a passing version in Try models, enter the real numbers under *Enter real adapter numbers*.

**Judges tab**

One card per judging criterion; each item ticks itself when it happens (e.g. *A correction became
training data*). The Demo card has a 3-minute timer and the five scenes: voice command, it fails, you
teach it, rerun works, Mubit tab.

## 4. Connect Claude through Mubit

The mock is for testing the flow. For the real thing, Claude makes every decision through Mubit's gateway,
and Mubit records each call (you can read every message in Mubit → **Requests**).

1. Sign in at <https://app.mubit.ai>. On **Get started**, create a Mubit key (starts with `mbt_`).
2. Under **Choose how calls are paid**, pick the starter credit if it's offered, or add your Anthropic key
   under **Provider keys**.
3. Create your `.env`:
   ```bash
   cp .env.example .env
   ```
   Put your key in `MUBIT_API_KEY=`. Leave `MUBIT_PROVIDER=anthropic` for Claude.
4. Restart `npm start`. It should say `anthropic / claude-haiku-4-5 via Mubit`, and the side panel pill turns green.
5. Run the demo again (step 3). Then open Mubit → **Requests**: every agent step is there, grouped into
   the tasks **next-action** and **done-check**.

If a call fails with `starter_credit_model`, the starter credit doesn't serve that model. The error lists
the ones it does serve: put one in `MUBIT_MODEL` and restart. To use OpenAI instead, set `MUBIT_PROVIDER=openai`
and an OpenAI model ID.

## 5. Start Mubit training tonight (critical path)

Mubit trains a task's first adapter at 25 **kept** examples, and its daily training limit resets at
**00:00 UTC**. Send varied traffic now:

```bash
npm run seed
```

That sends 60 next-action and 20 done-check calls (about 80 small calls) using the same system prompts as
the agent, so they land in the same tasks. Then watch Mubit → **Tasks** for `12 of 25 examples` and
**Training**. `npm run seed -- --dry-run` prints one example message without sending anything.

When a version passes, open it in **Try models** to compare it with Claude. Put the real cost and latency
ratio in `.env` (`ADAPTER_COST_RATIO`, `ADAPTER_LATENCY_MS`) so the ledger stops showing estimates.

## 6. Voice

- **Hold ⌥ Space** (Option + Space) on any page, or hold Mo, and talk. A waveform appears next to Mo
  with your words; let go and it runs. Esc cancels. The panel doesn't open: if it's already open it
  shows the run, otherwise Mo narrates. (The Fn/Globe key can't be used: macOS keeps it.)
- **Mic button**: uses Chrome's built-in speech recognition. The first time, Chrome opens a tab to allow
  the microphone (side panels can't ask). Allow it, close the tab and press the mic again. With
  "Run as soon as I finish speaking" ticked, the agent starts when you stop talking.
- **Wispr Flow** (or any dictation app): click the goal box and dictate. It types into the box like a
  keyboard, so it needs no setup.

## 7. Automated tests

```bash
npm test                              # unit + API tests (mock), ~1 s
npm run test:e2e                      # loads the extension in headless Chromium: fail → teach → rerun,
                                      # multi-page lessons, recorder edge cases, errors (~90 s)
HEADED=1 npm run test:e2e             # same, with a visible browser
SHOWME_E2E_LIVE=1 node --test tests/e2e.test.js   # main flow with your .env key, through Mubit
```

The first time, if Playwright says Chromium is missing: `npx playwright install chromium`.

## Rehearsal tips

- Changed the next-action prompt on 24 Oct (full toolset), so Mubit sees a new next-action task; the seed
  script was re-run for it. Check its count in Mubit → Tasks.
- With a real model, the first run is a genuine guess: Sitting times aren't visible to the agent.
  If Claude happens to pick the right one, press **Forget lessons** and ask for another time,
  e.g. `Book a table for four at quarter past nine` (Sitting D).
- Don't change the system prompts in `server/prompts.js`: Mubit would start a new task from zero.
  `npm test` fails if they change.
- Keep a recorded video of a good run as a fallback.

## Known limits

- The adapter can't drive the agent: Mubit has no adapter model ID yet, so live runs always use Claude,
  and the adapter is compared in Try models.
- Clicks are page-script clicks. A few sites ignore those; the demo site doesn't.
- `chrome://` pages and the Chrome Web Store can't be read by any extension.

## Sapling verifier

Every done-check and every risky click (pay, submit, confirm, reserve, delete…) also gets an
independent check from Banyan Sapling. It's on with a Mubit key and off in practice mode. Set
`SAPLING=on` or `SAPLING=off` to choose. Every call is logged to `verifier.log`. Try it on saved pages:

```bash
node verify-demo.js fixtures/booking-correct.txt
node verify-demo.js fixtures/booking-wrong-date.txt
node verify-demo.js fixtures/payment-page.txt
```
