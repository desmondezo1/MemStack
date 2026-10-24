# Mo: the 3-minute demo

**One person, her recurring work: Ada, office manager.** Every week the same chores come round. Mo is a work
assistant she teaches by showing it: she does a task once, adds a note where the page doesn't say enough, and the
task becomes one of her **skills**. Then Mo does it for her, again and again, and every correction makes it better
and trains Mubit's adapter.

## Before you record

- `npm start`, then reload Mo in `chrome://extensions` so the panel shows the newest version.
- Tabs: <http://localhost:8787/demo/sheet/>, <http://localhost:8787/demo/hr/>, <http://localhost:8787/demo/inbox/>
  and Mubit's console (Requests, Tasks, Try models).
- In PeopleDesk press **Clear this list**. In Mo's panel press **Forget lessons**.

## Script

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 to 0:15 | The "New starters" sheet: 10 rows | "This is Ada. She runs the office. Every Monday she types this week's new starters into the HR system, one by one." |
| 0:15 to 0:35 | Mo's panel: **+ From a sheet** → "Add a new starter" → **Read**: "10 rows" | "Mo is a work assistant she teaches by showing it. It reads her sheet with her own login: no API, no integration." |
| 0:35 to 1:05 | **Start: I'll do row 1.** Ada fills Kofi Mensah on PeopleDesk, presses Submit. ✎ on the start date: "a random weekday in the next two weeks, not in the sheet". ✎ on Team: "if Dept is blank, use Operations". **Done.** | "She does one row. Where the sheet doesn't say, she adds a note. Every step goes to Mubit as a training example." |
| 1:05 to 1:15 | The card: from column "Email"…, "a random weekday in the next 14 days", always "MacBook Air" | "Mo works out where every field comes from, and shows her before it does anything." |
| 1:15 to 1:45 | **Run 9 rows** (speed this part up in the edit) | "Then it does the rest. 'Eng' becomes Engineering. Sam's team is blank, so it follows her note. Every row is checked." |
| 1:45 to 2:00 | PeopleDesk: "Added so far (10)"; My skills: "Add a new starter · ran 9×" | "Ten starters, one row of effort. And it's now one of her skills: next Monday, she presses Run." |
| 2:00 to 2:25 | Inbox: "Unsubscribe me from DealDash" → Mo unsubscribes from everything → **Not what you wanted?** → she unticks only the marketing → "Unsubscribe me from StyleHub": done her way | "When Mo gets it wrong, she corrects it once. A sender it has never seen: done her way." |
| 2:25 to 2:50 | Mubit: Requests filtered by the `demo-…` session → **Try models** (below) | "In Mubit, those lessons are training the small model that replaces Claude for Mo. Same page: without her lesson, 'unsubscribe from all'; with it, 'untick the marketing'." |
| 2:50 to 3:00 | The fake PayPal "unsubscribe" email: flagged | "And the same Mo flags the phishing email before she clicks." |

Cut the inbox part first if you're over time. The other skills (cancel a subscription, the monthly software
audit) are in the README and below, ready for questions.

**Say plainly what's real.** Adapters can't be called from an app yet, so Mo runs on Claude through
Mubit. If an adapter has passed its tests by recording time, show it in Try models. If not, say: "This is
Claude with Ada's lesson; Mubit is training the adapter on these examples."

## The monthly software audit: teaching it

1. In the inbox, ask: "Check my inbox for subscriptions I pay for but don't use, and cancel them". Mo reads
   receipts but can't keep track across emails, so it gets stuck. Press **Show me how** (or **Not what you wanted?**).
2. Show it: open **Calmly: Your week in calm: 0 minutes** → **Manage my subscription** → **Manage subscription** →
   **Cancel subscription** → **No thanks, cancel my subscription** → **Back to your inbox** → open **Iron Gym: Your
   membership renews on 2 November** → **Manage my membership** → **Manage plan** → **Cancel membership** → reason
   **Not using it enough** → **Immediately** → untick the add-on → **Continue** → **No thanks, continue
   cancelling** → **Yes, cancel my membership**. Press **Done**.
3. Saving a lesson this long takes a minute or two: each step goes to Mubit as a training example.

## Try models: a correction changing an answer

In Mubit → **Try models**, pick **Control web browser** (newest number) and paste each input. Checked three
times each with Claude Haiku 5.5 through Mubit on 24 Oct:

| Input | Claude answered (3 of 3) | Meaning |
| --- | --- | --- |
| Unsubscribe A, no lesson | `{"action":"click","element_id":"e6","value":"","submit":false}` | e6 = "Unsubscribe from all emails" (loses her order updates) |
| Unsubscribe B, with the lesson Ada taught **on DealDash** | `{"action":"click","element_id":"e2","value":"","submit":false}` | e2 = untick "Weekly deals and offers", her way |
| Gym A, no lesson | `{"action":"select","element_id":"e4","value":"Other","submit":false}` | guesses the reason |
| Gym B, with Ada's lesson | `{"action":"select","element_id":"e4","value":"Moving away","submit":false}` | her reason |

The only difference between A and B is the "Demonstration" block Mo adds after Ada's correction.

### Unsubscribe A, no lesson

```text
Goal: Unsubscribe me from StyleHub

URL: http://localhost:8787/demo/inbox/unsubscribe.html?s=stylehub
Title: StyleHub · Email preferences
Headings: Sorry to see you go, Ada | Choose what you get
Text: Demo email preferences page for testing Mo. Nothing here is real. StyleHub Sorry to see you go, Ada You're signed up as ada@example.com. Pause all emails for 30 days (recommended) Choose what you get Weekly deals and offers Offers from our partners Order and delivery updates Save preferences Unsubscribe from all emails
Elements:
e1 button "Pause all emails for 30 days (recommended)"
e2 checkbox "Weekly deals and offers" checked=true
e3 checkbox "Offers from our partners" checked=true
e4 checkbox "Order and delivery updates" checked=true
e5 button "Save preferences"
e6 button "Unsubscribe from all emails"

Steps already taken:
1. click link "StyleHub New in: the autumn edit 🍂 08:05"
2. click link "Unsubscribe"

Answer with one JSON object only.
```

### Unsubscribe B, with the lesson Ada taught on DealDash

```text
Goal: Unsubscribe me from StyleHub

URL: http://localhost:8787/demo/inbox/unsubscribe.html?s=stylehub
Title: StyleHub · Email preferences
Headings: Sorry to see you go, Ada | Choose what you get
Text: Demo email preferences page for testing Mo. Nothing here is real. StyleHub Sorry to see you go, Ada You're signed up as ada@example.com. Pause all emails for 30 days (recommended) Choose what you get Weekly deals and offers Offers from our partners Order and delivery updates Save preferences Unsubscribe from all emails
Elements:
e1 button "Pause all emails for 30 days (recommended)"
e2 checkbox "Weekly deals and offers" checked=true
e3 checkbox "Offers from our partners" checked=true
e4 checkbox "Order and delivery updates" checked=true
e5 button "Save preferences"
e6 button "Unsubscribe from all emails"

Steps already taken:
1. click link "StyleHub New in: the autumn edit 🍂 08:05"
2. click link "Unsubscribe"

Demonstration recorded by a human on this page for the goal "Unsubscribe me from DealDash emails". It shows how this user wants this done: make the same choices for a similar goal, adapting names and values.
1. click link "DealDash 48 hours only: up to 70% off everything 09:12"
2. click link "Unsubscribe"
3. untick checkbox "Weekly deals and offers"
4. untick checkbox "Offers from our partners"
5. click button "Save preferences"

Answer with one JSON object only.
```

### Gym A, no lesson

```text
Goal: Cancel my Iron Gym membership

URL: http://localhost:8787/demo/gym/
Title: Iron Gym · Members
Headings: Cancel your membership
Text: Demo gym for testing Mo. Nothing here is real, and nothing is charged. IRONGYM Classes Trainers My bookings Cancel your membership Why are you leaving? Choose a reason… When should it end? At the end of this billing period (2 November) Immediately, with a refund for unused days Keep my Recovery+ add-on (£9 a month) Continue
Elements:
e1 link "Classes"
e2 link "Trainers"
e3 link "My bookings"
e4 select "Why are you leaving?" options=[Too expensive, Moving away, Injury, Not using it enough, Other]
e5 radio "At the end of this billing period (2 November)" group="When should it end?" checked=true
e6 radio "Immediately, with a refund for unused days" group="When should it end?" checked=false
e7 checkbox "Keep my Recovery+ add-on (£9 a month)" checked=true
e8 button "Continue"

Steps already taken:
1. click button "Manage plan"
2. click button "Cancel membership"

Answer with one JSON object only.
```

### Gym B, with Ada's lesson

```text
Goal: Cancel my Iron Gym membership

URL: http://localhost:8787/demo/gym/
Title: Iron Gym · Members
Headings: Cancel your membership
Text: Demo gym for testing Mo. Nothing here is real, and nothing is charged. IRONGYM Classes Trainers My bookings Cancel your membership Why are you leaving? Choose a reason… When should it end? At the end of this billing period (2 November) Immediately, with a refund for unused days Keep my Recovery+ add-on (£9 a month) Continue
Elements:
e1 link "Classes"
e2 link "Trainers"
e3 link "My bookings"
e4 select "Why are you leaving?" options=[Too expensive, Moving away, Injury, Not using it enough, Other]
e5 radio "At the end of this billing period (2 November)" group="When should it end?" checked=true
e6 radio "Immediately, with a refund for unused days" group="When should it end?" checked=false
e7 checkbox "Keep my Recovery+ add-on (£9 a month)" checked=true
e8 button "Continue"

Steps already taken:
1. click button "Manage plan"
2. click button "Cancel membership"

Demonstration recorded by a human on this page for the goal "Cancel my Iron Gym membership":
1. click button "Manage plan"
2. click button "Cancel membership"
3. select "Moving away" in select "Why are you leaving?"
4. click radio "Immediately, with a refund for unused days"
5. click checkbox "Keep my Recovery+ add-on (£9 a month)"
6. click button "Continue"
7. click button "No thanks, continue cancelling"
8. click button "Yes, cancel my membership"

Answer with one JSON object only.
```

### Done-check: the run that looked fine but wasn't

In the **Check whether browser task** task. The right answer is `"done":false` (the add-on still charges her,
and it ends on 2 November, not today).

```text
Goal: Cancel my Iron Gym membership today and drop the add-on

URL: http://localhost:8787/demo/gym/
Page text: Membership cancelled ✓ Iron Gym Plus ends: 2 November Reason: Other Your Recovery+ add-on is still active, so you will keep being charged £9 a month.

Answer with one JSON object only.
```

## Numbers you can say, and where they come from

| Claim | Source |
| --- | --- |
| 103 automated tests, plus 1 live-only | `npm run test:all` (unit, API and the extension in a real Chrome); the audit test runs only with `SHOWME_E2E_LIVE=1` |
| Phishing: 98 of 120 caught, no real site called phishing | `npm run seed:guard`, Claude Haiku 5.5, 24 Oct (TESTING.md) |
| Second check by Banyan Sapling | On by default with a Mubit key (`SAPLING=off` turns it off) |
| Adapter cost and speed | **Estimates** in the panel until you enter real numbers from Try models |
| Done-check adapter v1: 83.3% (10 of 12), needs 85% | Mubit's Adapters page, 24 Oct |
