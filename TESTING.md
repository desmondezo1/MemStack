# Test Mo locally

Mo was called Show Me until 24 Oct 2026; see the README for why.

About 10 minutes. You need Node 20.11+ and Google Chrome.

## 1. Start the backend

```bash
cd MemStack
npm install        # only installs Playwright, for the automated tests
npm start
```

You should see `Mo server on http://localhost:8787 · MOCK model (no MUBIT_API_KEY set)`.
Leave it running.

## 2. Load the extension

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `MemStack/extension` folder. (Already loaded? Press the
   reload icon on its card: new versions add files and the ⌥Space shortcut.)
3. Pin **Mo** from the puzzle-piece menu.

After any change to files in `extension/`, press the reload icon on the Mo card.

## 3. Run the demo offline (mock model)

1. Open <http://localhost:8787/demo/> (Trattoria Nove).
2. Click the **Mo** icon. The side panel opens; the pill says **Practice mode (no Mubit key)**.
3. Type `Book a table for two at eight` (or press the mic and say it) and press **Run**.
4. Watch it dismiss the popup, pick a party size, **guess Sitting A**, book, and fail the check:
   *Booked, but not at 20:00*.
5. Press **Show me how**. The page reloads with an orange "Mo is watching" badge. Do it yourself:
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
- **Right-click Mo** (or ⋯ on hover) for its menu: *Open Mo's panel*, *How to talk to me*,
  *Hide on this site*. The panel only ever opens from this menu.
- When it asks for help, clicking its bubble opens the menu with **Teach me (opens the panel)** on top.
- **New tabs** show Mo's own New Tab page (a search box, the talk hint, and Mo), because Chrome's
  built-in one can't run extensions. Chrome asks once whether to keep it.

### Asking questions

Ask a question instead of giving a task, e.g. *"What time do they open on Sunday?"* on the demo
restaurant. Mo finds the part of the page that answers it, scrolls there, and draws a box around
it with the answer. Mo says the answer too. If the answer isn't on the page, it navigates first. If it
can't find it, it asks you to show it: go to the page and **select the answer text**.

### Teaching ("Show me how")

- Every step you take flashes on the page (*Recorded: click*), and appears in the panel with its site.
  Click **×** on any step to remove it.
- **New tabs and tab switches** are recorded, and the recorder follows you to the new tab.
- **Selecting text** records "this is the answer" (for questions).
- When you press **Done**, Mo checks the lesson for detours, using simple rules and the model
  through Mubit. A result you opened and then came back from, typing you corrected, and opening a tab
  are suggested for removal. You review them (*Check your lesson*), and only the ticked steps are
  taught. If nothing looks unneeded, it saves straight away.

### Ada's inbox: the main demo

Open <http://localhost:8787/demo/inbox/>: Ada's inbox, 100 made-up emails. Three levels of the same chore:

- **Easy, unsubscribe.** Ask Mo: `Unsubscribe me from DealDash`. It opens the email, follows **Unsubscribe**, and on
  the preferences page picks **Unsubscribe from all emails**, which also stops her order and delivery updates. Press
  **Not what you wanted?**, then show it: open DealDash's email → **Unsubscribe** → untick **Weekly deals and offers**
  and **Offers from our partners** → **Save preferences**. Then ask `Unsubscribe me from StyleHub`: a sender Mo has
  never seen, done her way. The lesson is recalled because every sender's preferences page has the same address.
- **Medium, cancel a subscription.** Open **Iron Gym: Your membership renews on 2 November** and ask `Cancel my Iron
  Gym membership` (see the gym section below).
- **Hard, the monthly audit.** Ask `Check my inbox for subscriptions I pay for but don't use, and cancel them`. Mo
  sees one page at a time and keeps no notes, so it can't keep track of what it read across receipts. Show it once
  (Calmly, then the gym; the steps are in [docs/DEMO.md](docs/DEMO.md)) and it repeats the audit next time. If Mo
  suggests dropping steps as detours, keep them: **Back to your inbox** is needed.
- **Phishing in the same inbox.** **PayPal: Unsubscribe from PayPal promotional emails** links to a look-alike page.
  Mo Guard outlines and labels it; the real senders' unsubscribe links stay plain.

Lessons record whether you ticked or unticked a checkbox, and Mo is told to make the same choices for a similar
goal, so a lesson taught on one sender carries over to the next.

### The gym: cancelling through a maze

Open <http://localhost:8787/demo/gym/>, Iron Gym's members' page for "Ada". Ask Mo: `Cancel my Iron Gym membership`.

- The page fights back: a big **Pause my membership (recommended)** button that only pauses (and still charges),
  the real exit under **Manage plan → Cancel membership**, a form that defaults to ending "at the end of this billing
  period" with **Keep my Recovery+ add-on (£9 a month)** ticked, a **50% off** offer and an "Are you sure? 😢" screen.
- If Mo takes the pause button, or finishes with the add-on still charging, the check fails and Mo asks **Can you show
  me how?** If it finishes but not the way you'd want, for example ending "later" when you wanted "now", press
  **Not what you wanted? Show me how you'd do it**.
- Teach it once: **Manage plan → Cancel membership →** pick a reason **→ Immediately →** untick the add-on **→ Continue →
  No thanks, continue cancelling → Yes, cancel my membership**. Mo marks its mistake, saves the lesson, and sends each
  step to Mubit. **Run it again** and it cancels your way.
- **To see it in Mubit:** after a run or a lesson, the panel shows the Mubit session (`run-…` or `demo-…`). Click it to
  copy, then paste it into **Requests → Session** in Mubit's console to see those exact calls. The task is
  **Control web browser** (the newest number).

### Mo Guard (phishing links)

Mo keeps an eye on the links on every page, and on the page itself.

- **Try it:** open <http://localhost:8787/demo/guard/>, a team chat with a few phishing-style messages. After a moment Mo
  goes *"Hmm…"*, and the risky links get labels such as **⛔ Fake PayPal?**, **🚩 Pretends to be Netflix?** or
  **🚩 Suspicious link**. Real links stay untouched.
- **Click a label** to see why, then choose **It's fine** or **Yes, it's phishing**. Either answer is remembered for that
  site and sent to Mubit as a training example.
- **Click a phishing link** and Mo stops you with a full-screen warning: **Take me to the real PayPal**, **Stay here**
  or **Open it anyway**.
- **Open a phishing page directly**, e.g. the practice page at `http://paypal-com-login.localhost:8787/demo/guard/login.html?brand=PayPal`,
  and the warning covers it: **Take me to the real PayPal**, **Get me out of here** or **I trust this site**.
  `*.localhost` addresses always mean your own computer, so the practice pages are safe.
- **Mo's ⋯ menu** (or right-click Mo) has **Mo Guard: on/off** and **Report this page as phishing**.

How it decides:
- **Instant rules, no AI:** look-alike spellings (`paypa1.com`), a brand's name on someone else's domain, link text
  that shows a different address, odd addresses, free website builders, risky domain endings, domain age (from public
  registration records) and OpenPhish's public list of reported phishing links.
- **Claude, through Mubit, only for links the rules find risky:** the Mubit task **link-check** answers with fixed
  labels only (`{"verdict": "phishing", "pretends_to_be": "paypal.com"}`), so Mubit can train an adapter on it.
- Only link addresses, their text and the page's address are sent, never page content or anything you type.

Seed it, or re-score Claude, with `npm run seed:guard`. It sends live phishing links from OpenPhish and real links
(addresses only; no page is ever opened) and saves Claude's score for the Mubit tab. Last run: 90% right, 98 of 120
phishing links caught, no real site called phishing and 3 of 120 marked suspicious. Phishing pages whose address
gives nothing away can only be caught by the public list or the page itself, so Mo says "looks suspicious", never
"you're safe". Keep Chrome's own Safe Browsing on.

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

- **Flow diagram**: a dot travels Browser → Mo → Mubit → Claude on every call. Taught steps drop
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
4. Restart `npm start`. It should say `anthropic / claude-haiku-5-5 via Mubit`, and the side panel pill turns green.
5. Run the demo again (step 3). Then open Mubit → **Requests**: every agent step is there, grouped into
   the tasks Mubit names **Control web browser** (next-action) and **Check whether browser task** (done-check).
   To find one run, copy the session ID the panel shows after it and filter **Requests** by that session.

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

## Live check (real websites, real model)

`npm test` uses local pages so it's quick and repeatable. `npm run live` is the opposite: the real
extension in a visible browser, real Claude through Mubit, on real sites. It covers YouTube (play a
video), Wikipedia (when was Burna Boy born), the weather in London tomorrow, and teaching on Wikipedia
with a deliberate detour. Goals only read and search; nothing is booked, bought or submitted. It
prints each step and saves screenshots and `report.json` in `test-results/live/`. A run costs about
half a cent of Mubit credit.

```bash
npm run live                    # all four
npm run live -- wikipedia       # only the matching ones
```

Google often blocks automated searches with an "unusual traffic" page. The agent is expected to go
to another site, not to try to get past it.

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
independent check from Banyan Sapling. It's **on by default whenever a Mubit key is set**, and off in practice
mode. Set `SAPLING=off` to turn it off (or `SAPLING=on` to force it on). Every call is logged to `verifier.log`. Try it on saved pages:

```bash
node verify-demo.js fixtures/booking-correct.txt
node verify-demo.js fixtures/booking-wrong-date.txt
node verify-demo.js fixtures/payment-page.txt
```
