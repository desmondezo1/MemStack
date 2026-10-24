# Mo

**Mo is a browser assistant that does things for you, learns when you show it how, and keeps you safe while you browse.**

Mo lives in your browser as a small orange character in the corner of every page. Hold <kbd>⌥</kbd> <kbd>Space</kbd>
and tell it what you want: it works through the page step by step. When it gets stuck, it asks you to show it once,
and next time it gets it right. While you browse, it keeps an eye on the links around you and warns you before a
phishing link can trick you.

Every decision Mo makes runs on Claude through [Mubit](https://docs.mubit.ai), which records it and trains a small
model of its own for each kind of decision. Mo gets cheaper and faster the more it's used, and every correction you
make teaches it.

> Mo started life as **Show Me**, a browser agent you teach by hand. On 24 Oct 2026 we renamed it Mo: it had grown
> into an assistant that helps and keeps you safe, so we named it after the character at its centre. Some internal
> names (`showme:` messages, `SHOWME_*` settings) keep the old name.

## One user, one chore: Ada cancels her gym

Ada wants to cancel her gym membership. The gym's site is built to stop her. The big button only *pauses* the
membership (and still charges her). The real exit hides under "Manage plan". The form defaults to ending "later"
and keeps a paid add-on ticked. Then there's a "50% off" offer and an "Are you sure? You'll lose your streak 😢".

Ada holds <kbd>⌥</kbd> <kbd>Space</kbd> and says *"Cancel my Iron Gym membership"*. Mo works through it. Where it
can't know what she wants (end it now or later? keep the add-on?) or gets it wrong, it asks *"Can you show me
how?"*, or she presses *"Not what you wanted?"*. She does it once. Mo marks the step where it went wrong, saves the
lesson, and sends each step to Mubit as a training example. Next time, Mo cancels her way, start to finish.

Every subscription uses the same tricks, so Ada comes back. Mo learns them once from her, then does the chore
for her: faster each time, cheaper once Mubit's adapter takes over. The same Mo keeps an eye on the links in her
chats and warns her before a phishing link can trick her.

Try it: <http://localhost:8787/demo/gym/> (a demo gym; nothing is real or charged).

## What else you can use it for

| You want to… | What Mo does |
| --- | --- |
| **Get something done in the browser** | "Play a Burna Boy video", "book a table for two at eight", "find running shoes sorted by price". Mo opens the site, searches, clicks and types, then checks the page to confirm it really worked. |
| **Teach it your way of doing a task** | When Mo gets stuck it says *"Can you show me how?"*. You do the task once and Mo records each step. Next time it follows your lesson, and each step goes to Mubit as a training example. Afterwards Mo even shows the step where it went wrong. |
| **Get an answer without hunting for it** | "When was Burna Boy born?", "What's the weather in London tomorrow?". Mo finds the right page and highlights the answer on it. |
| **Stay safe from phishing** | Mo checks the links on every page. A fake PayPal link in a chat gets a **⛔ Fake PayPal?** label, and opening a phishing page shows a full-screen warning with **Take me to the real PayPal**. Your "it's fine" / "it's phishing" answers teach it. |
| **Do it hands-free** | Hold <kbd>⌥</kbd> <kbd>Space</kbd> (or hold Mo), talk, and let go. Mo listens, shows a live waveform, and gets on with it. Esc cancels. |
| **See what it learned and what it saves** | The side panel shows every Mubit call live, the lessons you've taught, the failures that became fixes, and what each decision costs on Claude versus a trained adapter. |

**Who it's for:**
- People who repeat the same web chores, like bookings, forms and searches.
- Anyone who wants a second pair of eyes on suspicious links, including in chats and emails.
- Teams who want a browser assistant that gets cheaper and better from their own corrections rather than paying top-model prices for every click.

## Quick start

```bash
npm install
cp .env.example .env      # add your Mubit key (without one, Mo runs in practice mode)
npm start                 # backend on http://localhost:8787
```

1. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `extension/` folder.
2. Try the demos:
   - **The gym (main demo):** <http://localhost:8787/demo/gym/>. "Cancel my Iron Gym membership", then show Mo how you'd do it.
   - **The restaurant:** <http://localhost:8787/demo/>. Ask Mo to "book a table for two at eight", and teach it when it gets stuck.
   - **The video site:** <http://localhost:8787/demo/tube/>. "Play a Wizkid video".
   - **The phishing chat:** <http://localhost:8787/demo/guard/>. Watch Mo flag the fake links.
3. Click Mo's icon in the toolbar to open its panel, or just hold <kbd>⌥</kbd> <kbd>Space</kbd> on any page.

The full walkthrough, settings and live checks are in [TESTING.md](TESTING.md). The original plan is in [docs/IDEA.md](docs/IDEA.md).

## How it works

```
 you ──► Mo (Chrome extension) ──► Mo's backend ──► Mubit gateway ──► Claude
          reads the page as text      holds the key      records every call,
          acts, records lessons,      rules, memory      trains an adapter per task
          flags risky links
```

- **Mo reads pages as text, not screenshots:** a short list of the buttons, links and fields on screen. That keeps every decision small and repeatable, which is exactly what Mubit can learn from.
- **Each kind of decision is its own Mubit task**, with fixed instructions and a short fixed answer, and no free-text reasons, so a small adapter can match Claude:

| Mubit task (Mubit's name) | The question | Answer |
| --- | --- | --- |
| `next-action` (Control web browser) | What's the next step? | `{"action", "element_id", "value", "submit"}` |
| `done-check` (Check whether browser task) | Did it work? | `{"done", "problem"}` |
| `link-check` (Check links) | Is this link phishing? | `{"verdict", "pretends_to_be"}` |
| `locate` (Find information) | Where's the answer on this page? | the block that holds it |
| `refine-lesson` (Clean up human's demonstration) | Which taught steps were detours? | steps to drop |
| `safety-gate` (Protect user) | Is this risky click OK? | allow or block |

- **Lessons and corrections become training data.** Mubit trains on Claude's answers, so a lesson is re-sent with your demonstration attached. Claude's answer then becomes a new example of the same task.
- **Mo keeps your data small.** Link checks send only link addresses, never page content or anything you type. Your Mubit key stays on the backend, and `.env` is never committed.

## What's where

| Part | What it does |
| --- | --- |
| `extension/mascot.js` | Mo on every page: moods, eyes that follow your pointer, push-to-talk and the waveform, menu. |
| `extension/sidepanel.*` | Mo's panel: goal box, step-by-step timeline, "Show me how" teaching, mistake view, live savings. |
| `extension/panel-mubit.js`, `panel-judges.js` | The Mubit tab (live calls, tasks, lessons, fixes, cost) and the Judges tab (criteria that tick from live evidence). |
| `extension/agent-core.js`, `voice-core.js` | The agent loop and push-to-talk, shared by the panel and background runs. |
| `extension/content.js` | Reads the page as text, performs actions, records your demonstrations. |
| `extension/guard.js`, `server/guard.js`, `server/guard-data.js` | Mo Guard: phishing labels, Mo's reactions and the full-screen warning; rules first, then Claude through Mubit. |
| `extension/background.js`, `voice.html` / `voice.js` | Push-to-talk routing; listens offscreen when the panel is closed. |
| `extension/newtab.html` | Mo's own New Tab page, so Mo is there on new tabs too. |
| `extension/mubit-bridge.js` | Reads kept examples and adapter status from Mubit's console when it's open in a tab (read-only). |
| `server/index.js` | The backend the extension calls. It holds the Mubit key, since Mubit refuses browser calls. |
| `server/llm.js`, `server/prompts.js` | Every model call goes through Mubit; the fixed instructions per task live here (a test guards them). |
| `server/memory.js`, `server/refine.js` | Lessons, recalled into later runs; detours removed from demonstrations before they train anything. |
| `server/ledger.js` | Local log of every call: counts, speed, cost. |
| `server/verifier.js` | A second, independent check from Banyan Sapling on "did it work?" and before risky clicks. On whenever a Mubit key is set; `SAPLING=off` turns it off; always off in practice mode. |
| `server/demo-site/` | Iron Gym (a cancel-your-membership maze), Trattoria Nove (restaurant), Tubely (offline video site) and the phishing demo chat. |
| `scripts/seed-traffic.js`, `scripts/seed-guard.js` | Send practice calls through Mubit so each task has enough examples to train; `seed-guard` also scores Claude on known phishing and real links. |
| `exam/` | Does the adapter learn? Mubit-routed vs provider-only on Mind2Web and the demo sites. |

## Tests

```bash
npm test             # unit and API tests (practice mode, no key needed)
npm run test:all     # plus the extension in a real (headless) Chrome
npm run live         # real sites with the real model through Mubit (see TESTING.md)
```

## Limits

- **Trained adapters run in Mubit's Try models page, not in Mo yet:** Mubit has no way for an app to call an adapter. Mo uses Claude through Mubit, and every call trains the adapters.
- **Mo Guard says "looks suspicious", never "you're safe".** A brand-new phishing page with a clean address can slip past checks that only look at the address. Keep Chrome's own Safe Browsing on.
- **Some pages are off limits to every extension:** `chrome://` pages, the Chrome Web Store and the built-in PDF viewer.
