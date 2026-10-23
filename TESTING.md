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
2. Click **Load unpacked** and choose the `MemStack/extension` folder.
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
