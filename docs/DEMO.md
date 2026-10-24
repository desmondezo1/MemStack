# Mo: the 3-minute demo

One person, one chore, one task from start to finish: **Ada cancels her gym membership.** The gym's site
is built to stop her. Mo gets it wrong in a way only Ada can know, she shows it once, and the next run
does it her way. Then we show where that correction went in Mubit.

## Before you record

- `npm start` in the repo, and reload Mo in `chrome://extensions` so the panel shows the newest version.
- Open <http://localhost:8787/demo/gym/> in one tab and Mubit's console (Requests, Tasks, Try models) in another.
- In Mo's panel, press **Forget lessons** so the first run starts fresh (it clears every saved lesson).

## Script

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 to 0:20 | Iron Gym's members' page | "This is Ada. Every few months she cancels something: a gym, a streaming service, a trial. These sites are built to stop her. This one has a big 'Pause' button that still charges her." |
| 0:20 to 1:00 | Hold ⌥ Space: "Cancel my Iron Gym membership". Mo works through it. | "Mo is Claude Haiku 5.5, and every call goes through Mubit. It ignores the pause trap and finds the real exit… and it's done. But look at the result: it ends on 2 November, and the £9 add-on is still charging her. Mo couldn't know that's not what Ada wants." |
| 1:00 to 1:40 | Press **Not what you wanted? Show me how you'd do it**. Ada does it: Manage plan → Cancel membership → Moving away → Immediately → untick the add-on → Continue → No thanks → Yes, cancel. | "So she shows it once, her way." |
| 1:40 to 2:00 | The panel: "Mistake at step 3…", "sent 8 training examples through Mubit", the session ID | "Mo marks where it went wrong, saves the lesson, and sends each step to Mubit as a training example, under this session." |
| 2:00 to 2:20 | **Run it again** | "Next time: ends today, add-on cancelled, offer declined. Her way, start to finish." |
| 2:20 to 2:50 | Mubit: Requests filtered by the session → Tasks → Try models (below) | "In Mubit, here are those exact calls. They're examples for the 'Control web browser' task, the adapter Mubit is training to replace Claude for Mo. Same page, same question: without Ada's lesson the answer is 'Other'; with it, 'Moving away'." |
| 2:50 to 3:00 | (Optional) the phishing chat: a fake PayPal link gets a label | "The same Mo also checks the links in her chats." Cut this if you're over time. |

**Say plainly what's real.** Adapters can't be called from an app yet, so Mo runs on Claude through
Mubit. If an adapter has passed its tests by recording time, show it answering in Try models. If not,
say so: "This is Claude with Ada's lesson; Mubit is training the adapter on these examples."

## Try models: the correction changing an answer

In Mubit → **Try models**, pick the **Control web browser** task (newest number) and paste each input.
Checked with Claude Haiku 5.5 through Mubit on 24 Oct:

- **Input A (no lesson):** Claude answered `{"action":"select","element_id":"e4","value":"Other","submit":false}`.
- **Input B (with Ada's lesson):** Claude answered `{"action":"select","element_id":"e4","value":"Moving away","submit":false}`.

The only difference between A and B is the "Demonstration" block Mo adds after Ada's correction.

### Input A, no lesson

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

### Input B, with Ada's lesson

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
| 93 automated tests | `npm run test:all` (unit, API and the extension in a real Chrome) |
| Phishing: 98 of 120 caught, no real site called phishing | `npm run seed:guard`, Claude Haiku 5.5, 24 Oct (TESTING.md) |
| Second check by Banyan Sapling | On by default with a Mubit key (`SAPLING=off` turns it off) |
| Adapter cost and speed | **Estimates** in the panel until you enter real numbers from Try models |
| Done-check adapter v1: 83.3% (10 of 12), needs 85% | Mubit's Adapters page, 24 Oct |
