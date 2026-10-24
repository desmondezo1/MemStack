# Mo: the 3-minute demo

**One person, one recurring chore: Ada's subscriptions.** Her inbox fills up with marketing every week, and
she pays for things she stopped using. Every site is built to keep her. Mo does the chore, gets it wrong in a
way only Ada could know, she shows it once, and from then on Mo does it her way, even on a sender it has never
seen. Three levels of the same chore: **unsubscribe** (easy), **cancel a subscription** (medium), **the monthly
audit** (hard).

## Before you record

- `npm start`, then reload Mo in `chrome://extensions` so the panel shows the newest version.
- Tabs: <http://localhost:8787/demo/inbox/> and Mubit's console (Requests, Tasks, Try models).
- In Mo's panel press **Forget lessons**. Then, off camera, teach the **audit** once (see "Hard" below) so the
  "next month" rerun is ready. Leave the unsubscribe lesson untaught: you teach that one on camera.

## Script

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 to 0:15 | Ada's inbox: 100 emails | "This is Ada. Every week her inbox fills with marketing, and she pays for apps she stopped using. Every one of these sites is built to keep her." |
| 0:15 to 0:45 | **Easy.** Hold ⌥ Space: "Unsubscribe me from DealDash". Mo opens the email, follows Unsubscribe, clicks "Unsubscribe from all emails" → "Yes". | "Mo is Claude Haiku 5.5, every call through Mubit. It did unsubscribe… from everything, including her order and delivery updates. Mo couldn't know she wants those." |
| 0:45 to 1:10 | **Not what you wanted?** Ada: opens DealDash, Unsubscribe, unticks *Weekly deals* and *Partner offers*, **Save preferences**. | "So she shows it once. Mo marks its mistake and sends each step to Mubit as a training example." |
| 1:10 to 1:30 | "Unsubscribe me from StyleHub" | "A different sender it has never seen. Her way: marketing off, order updates kept." |
| 1:30 to 1:50 | **Medium.** Open the Iron Gym renewal email: "Cancel my Iron Gym membership" (optional if time is short) | "Same tricks on a bigger scale: a 'pause' button that still charges, the exit hidden under Manage, a paid add-on left ticked. One lesson and it's done her way." |
| 1:50 to 2:20 | **Hard.** "Check my inbox for subscriptions I pay for but don't use, and cancel them" | "The monthly audit. Last month she showed it once. Now Mo cancels Calmly, 0 minutes used, then the gym she hasn't visited in 42 days, on two different sites." |
| 2:20 to 2:45 | Mubit: Requests filtered by the `demo-…` session → Tasks → **Try models** (below) | "Here are those calls in Mubit, training the adapter that replaces Claude for Mo. Same StyleHub page: without Ada's DealDash lesson the answer is 'Unsubscribe from all'; with it, 'untick Weekly deals'." |
| 2:45 to 3:00 | The fake "Unsubscribe from PayPal promotional emails" in her inbox: dashed outline and label | "And when an 'unsubscribe' email is really phishing, the same Mo flags it before she clicks." |

**Say plainly what's real.** Adapters can't be called from an app yet, so Mo runs on Claude through
Mubit. If an adapter has passed its tests by recording time, show it in Try models. If not, say: "This is
Claude with Ada's lesson; Mubit is training the adapter on these examples."

## Hard: teaching the audit (off camera, before recording)

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
| 97 automated tests, plus 1 live-only | `npm run test:all` (unit, API and the extension in a real Chrome); the audit test runs only with `SHOWME_E2E_LIVE=1` |
| Phishing: 98 of 120 caught, no real site called phishing | `npm run seed:guard`, Claude Haiku 5.5, 24 Oct (TESTING.md) |
| Second check by Banyan Sapling | On by default with a Mubit key (`SAPLING=off` turns it off) |
| Adapter cost and speed | **Estimates** in the panel until you enter real numbers from Try models |
| Done-check adapter v1: 83.3% (10 of 12), needs 85% | Mubit's Adapters page, 24 Oct |
