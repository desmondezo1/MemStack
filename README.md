# Mo

**Mo is a work assistant that lives in your web browser. You teach it a task by doing the task once while it
watches. From then on, Mo can do that task for you, again and again, and it gets better every time you correct it.**

This README tells one story from start to finish: **Sarah**, a customer success associate, and a task she has to do
by hand every single week. Everything in this repository (the product, the demo pages, the tests and the films) is
built around her story. Nothing below assumes you already know her job or the tools she uses.

> Mo started life as **Show Me**, a browser agent you teach by hand. On 24 Oct 2026 we renamed it Mo. Some internal
> names (`showme:` messages, `SHOWME_*` settings) keep the old name.

## Who Sarah is

Sarah works at a small software company. Her job title is **Customer Success Associate**.

**What "customer success" means:** when a business buys a software product, someone at the software company makes
sure that customer gets set up, knows who to talk to, and actually gets value from what they bought. That's
customer success. Sarah answers new customers' questions, helps them get started, and makes sure nobody falls
through the cracks. The part of the job she loves is talking to people and solving their problems.

## The task she repeats every week

Every **Monday morning**, the company's **sales team** sends Sarah an email. Attached is a **spreadsheet**: a CSV file
(a simple table file that Excel or Google Sheets can open). Each row is one customer who signed up the week before.
The columns are:

| Company | Contact | Email | Plan | Owner | Start date |
| --- | --- | --- | --- | --- | --- |
| Northwind Ltd | Priya Nair | priya@northwind.example | Growth | Sarah K | 03/11/2026 |
| Kestrel Labs | Ama Owusu | ama@kestrellabs.example | Ent | Sarah K | 04/11/2026 |
| Lumen Health | Mei Lin | mei@lumenhealth.example | Enterprise | *(blank)* | 05/11/2026 |
| … 40 to 50 rows a week | | | | | |

Before the support team can help any of these customers, each one has to exist in the company's **support system**
(also called a helpdesk: the tool support staff use to see customers and answer their tickets). There is no import
button that Sarah can use, so she types each customer in **by hand**, through a form called **"Add a customer
account"**. For every single row she:

1. Copies the company name from the spreadsheet, switches tabs, and pastes it into the form.
2. Does the same for the contact name and the email address.
3. Picks the plan from a dropdown (Starter, Growth or Enterprise).
4. Types the account owner: the colleague responsible for that customer.
5. Types the start date, then **works out the renewal date** (one year after the start date), which is not in the
   spreadsheet at all.
6. Presses **Create account**, checks it saved, and goes back to the spreadsheet for the next row.

That is about **12 clicks and two tab switches per customer**, and around **47 customers a week**: most of a Monday
morning, every Monday. It's not hard, but it's slow, easy to get wrong when you're tired, and it keeps her away from
the customers she's supposed to be helping.

**And the spreadsheet is messy, because people type it.** Some rows need a human decision:

- **Abbreviations:** the plan says "Ent", "ENT" or "Gro" instead of "Enterprise" or "Growth".
- **Missing values:** the Owner cell is blank, and Sarah's rule is that blank means "assign it to me".
- **Values that aren't there at all:** the renewal date has to be calculated from the start date.
- **Mistakes:** an email like `accounts@tidalstudio` has no domain, so the form refuses it. Sarah has to stop and
  check with Sales rather than guess.

This is exactly the kind of work Mo is for: the same form, the same steps, dozens of times a week, with a few small
judgement calls that only Sarah knows how to make.

## What changes with Mo

1. **Mo opens the file for her.** Sarah holds <kbd>⌥</kbd> <kbd>Space</kbd> and says *"Check my email and open the new
   customers file from Sales."* Mo opens her inbox, finds Grace's email, and opens the CSV attachment. (Live with
   Claude, that takes about three steps.)
2. **She shows Mo the first customer, once.** In Mo's panel she presses **+ From a sheet**, picks the tab with the
   CSV, and Mo reads every row. Then she fills in the first customer on the support system herself while Mo
   watches and records each step.
3. **She adds notes where the spreadsheet doesn't say.** Next to any recorded step she can press ✎ and type a note,
   like *"Renewal date: one year after the start date. It isn't in the CSV."* or *"If Owner is blank, assign it to
   me."* Mo keeps the notes with the lesson.
4. **Mo works out the pattern and shows it to her.** From that one row, Mo works out where every field comes from:
   the company comes from the "Company" column, the plan from the "Plan" column (matched to the closest option in
   the dropdown), the renewal date from her note. She can change any of these before anything runs.
5. **Mo does the other 46.** It goes row by row, filling in the form and pressing Create account, and checks each
   result. "Ent" becomes Enterprise, a blank owner follows her note, and each renewal date is worked out from that
   row's start date.
6. **When something is genuinely wrong, Mo doesn't guess.** The row with the broken email is marked **"needs a look"**
   and skipped, with the form's own error message, so Sarah can fix it with Sales. Every other row is done.
7. **It's now one of her skills.** "Add a customer account" appears under **My skills** in Mo's panel. Next Monday she
   presses **Run**, picks the new CSV, and Mo does the whole job. If Mo ever gets something wrong, she presses
   **Not what you wanted?** and shows it once more; the skill learns from the correction.

What took most of a Monday morning now takes a few minutes of her checking, and she's back to talking to customers.

## Why it gets cheaper and faster over time: Mubit

Every decision Mo makes (which field to fill, what to type, whether the page shows the job is done) is made by
**Claude**, a large AI model from Anthropic. Every one of those calls goes through **[Mubit](https://docs.mubit.ai)**.

Mubit does two things with them:

1. **It records each call as a training example.** Because Sarah's task repeats with exactly the same shape every
   week (same form, same columns, same kinds of decisions), Mubit collects many near-identical examples quickly.
   The steps Sarah teaches, and every correction she makes, are sent to Mubit as examples too.
2. **It trains a smaller, cheaper AI model for that kind of decision** (Mubit calls it an *adapter*), and tests it
   against Claude's answers. Once a version passes, that small model can do the same job as Claude for a fraction
   of the cost and with much lower delay.

That's why the repetition matters: **the more often Sarah's task runs, the more Mubit learns, and the cheaper and
faster the same Monday task becomes.** Mo's panel shows every call going through Mubit, the training examples
collected, and what each decision costs on Claude compared with a trained adapter (an estimate until real adapter
numbers are entered from Mubit's console).

To be clear about where things stand today: Mo runs every step on Claude through Mubit, and Mubit trains the
adapters on that traffic. Mubit doesn't yet let an app call a trained adapter directly, so adapters are tested in
Mubit's **Try models** page rather than inside Mo.

## Other things Sarah's Mo does

The same assistant helps with her other repetitive browser chores, each taught once (all on demo pages in this repo):

| Task | What Mo does |
| --- | --- |
| **Clear marketing from the shared inbox** | Unsubscribes from a sender her way (stop the marketing, keep order and delivery updates), then does the same for senders it has never seen. |
| **Cancel a subscription the team stopped using** | Gets past the "Pause (recommended)" trap and the "50% off" offer, and cancels the way she showed it. |
| **The monthly software audit** | Repeats the audit she taught it, across two different websites. |
| **Stay safe from phishing** | Checks the links on every page. A fake "unsubscribe" email that leads to a PayPal look-alike gets a warning label before she clicks it. |
| **Hands-free** | Hold <kbd>⌥</kbd> <kbd>Space</kbd>, say the task, and let go. Esc cancels. |

**Who Mo is for:** anyone whose job includes the same browser task over and over (copying records from one system into
another, filling in the same forms, processing the same kind of request), especially people like Sarah, whose real
work is with people and whose weekly admin keeps getting in the way.

## Quick start

```bash
npm install
cp .env.example .env      # add your Mubit key (without one, Mo runs in practice mode)
npm start                 # backend on http://localhost:8787
```

1. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `extension/` folder.
2. Try Sarah's demo (the main one):
   - Open <http://localhost:8787/demo/inbox/> (her inbox) and <http://localhost:8787/demo/helpdesk/> (the support
     system's "Add a customer account" form).
   - In the inbox tab, ask Mo: *"Check my email and open the new customers file from Sales."* Mo opens the email from
     Grace and the CSV attachment (`/demo/files/new-customers-week-45.csv`, 12 customers, messy on purpose).
   - In Mo's panel press **+ From a sheet**, name it *Add a customer account*, pick the CSV's tab and press **Read**.
   - Switch to the Helpdesk tab, press **Start: I'll do row 1**, and fill in Northwind Ltd (renewal 03/11/2027).
     Press ✎ on *Renewal date*: "One year after the start date. It isn't in the CSV." and on *Account owner*: "If Owner
     is blank, use Sarah K". Press **Done**, check the rules, and press **Run 11 rows**.
   - Other demos:
   - **New starters (sheet to form):** open <http://localhost:8787/demo/sheet/> and <http://localhost:8787/demo/hr/>, then in Mo's panel press **+ From a sheet**, read the sheet, and do row 1 on the form.
   - **Sarah's inbox (other skills):** <http://localhost:8787/demo/inbox/>. "Unsubscribe me from DealDash", then "Cancel my Iron Gym membership", then the monthly audit.
   - **The gym:** <http://localhost:8787/demo/gym/>. "Cancel my Iron Gym membership" on its own.
   - **The restaurant:** <http://localhost:8787/demo/>. Ask Mo to "book a table for two at eight", and teach it when it gets stuck.
   - **The video site:** <http://localhost:8787/demo/tube/>. "Play a Wizkid video".
   - **The phishing chat:** <http://localhost:8787/demo/guard/>. Watch Mo flag the fake links.
3. Click Mo's icon in the toolbar to open its panel, or just hold <kbd>⌥</kbd> <kbd>Space</kbd> on any page.

The full walkthrough, settings and live checks are in [TESTING.md](TESTING.md). The demo script is in [docs/DEMO.md](docs/DEMO.md). The films about Sarah are in [video/](video/README.md) (`video/out/sarah-and-mo.mp4`). The original plan is in [docs/IDEA.md](docs/IDEA.md).

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
| `extension/sheet-core.js` | Sheet to form: reads rows (CSV, a Google Sheet through its CSV download, any HTML table), works out each form field's rule from the row you did, and the values for every other row. |
| `extension/agent-core.js`, `voice-core.js` | The agent loop and push-to-talk, shared by the panel and background runs. |
| `extension/content.js` | Reads the page as text, performs actions, records your demonstrations. |
| `extension/guard.js`, `server/guard.js`, `server/guard-data.js` | Mo Guard: phishing labels, Mo's reactions and the full-screen warning; rules first, then Claude through Mubit. |
| `extension/background.js`, `voice.html` / `voice.js` | Push-to-talk routing; listens offscreen when the panel is closed. |
| `extension/newtab.html` | Mo's own New Tab page, so Mo is there on new tabs too. |
| `extension/mubit-bridge.js` | Reads kept examples and adapter status from Mubit's console when it's open in a tab (read-only). |
| `server/index.js` | The backend the extension calls. It holds the Mubit key, since Mubit refuses browser calls. |
| `server/llm.js`, `server/prompts.js` | Every model call goes through Mubit; the fixed instructions per task live here (a test guards them). |
| `server/memory.js`, `server/refine.js` | Skills and their lessons (with your notes), recalled into later runs; detours removed from demonstrations before they train anything. |
| `server/ledger.js` | Local log of every call: counts, speed, cost. |
| `server/verifier.js` | A second, independent check from Banyan Sapling on "did it work?" and before risky clicks. On whenever a Mubit key is set; `SAPLING=off` turns it off; always off in practice mode. |
| `server/demo-site/` | Sarah's Helpdesk form and the CSV from Sales (`files/`), the New starters sheet and PeopleDesk (an HR form), Sarah's inbox (100 made-up emails and an email preferences page), Calmly and Iron Gym (subscriptions to cancel), Trattoria Nove (restaurant), Tubely (offline video site) and the phishing demo chat. |
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
