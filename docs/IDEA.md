# Show Me — the browser agent you teach by hand

> **Renamed:** this project is now called **Mo** (24 Oct 2026). It grew from "Show Me", the browser agent you teach by hand, into an assistant that helps and keeps you safe. This document is kept as written at the time; see the [README](../README.md) for what Mo is today.

> **Fail once, teach once, never again.**
>
> Night Shift London · Mubit track · demo Sunday 25 Oct 2026, 10:00

This is the team's working doc for what we are building and why. Read it top to bottom once, then use the
[build plan](#build-plan) and [open questions](#open-questions-ask-the-mubit-crew) as the checklist.

---

## The idea in 30 seconds

Browser agents fail every day: wrong button, missed modal, stuck on a form. When a human steps in and fixes
it, the agent learns nothing, and next time it fails the same way. On top of that, every click costs a
frontier-model call.

**Show Me** changes what a correction is:

1. You **say** what you want ("book a table for two at eight").
2. The agent **tries** it in a real browser.
3. If it fails, it says **"show me"**, and you do the task once by hand.
4. Every click you make is recorded and sent through **Mubit** as a training example of the agent's decision step.
5. The agent **reruns** and succeeds. Mubit trains a **small model of that decision** that answers like GPT
   at a fraction of the cost and latency.

One demonstration = many training examples. That is the hook nobody else in the room will have: everyone
else corrects a label; we correct by *showing*.

**Why the repo is called MemStack:** the agent's short-term memory (the demonstrations it recalls on the
rerun) lives in our stack; the long-term learning (the trained adapter) lives in Mubit. Two layers, one
correction.

---

## What Mubit actually is (and isn't)

Checked against [docs.mubit.ai](https://docs.mubit.ai/llms-full.txt) on 23 Oct. Don't pitch anything
that isn't on this list.

| Mubit does | Mubit does **not** |
| --- | --- |
| Sits between our app and the provider: we change the **base URL** and the **key**, model IDs stay the same. | Remember anything for our agent. It is not a memory layer. |
| Records every call (request + reply) in **Requests**. | Give us a model ID for the adapter. **Our app cannot call the adapter.** |
| Groups calls into a **task** when they share model, system prompt, tools, tool choice and output format. | Train on images/screenshots (never mentioned in the docs). |
| Picks **kept examples**; a task first trains at **25 kept examples** (not every call is kept). | Offer a feedback/correction API. The only rating is a Good/Bad button in the console. |
| Trains an **adapter** (small open model for one task), tests it against the provider's answers: `Passed`, `Below target`, `Prompt only`, ... | Let us trigger or retry training. It trains when enough *new* examples arrive. |
| Lets us compare a passing adapter vs the provider side by side in **Try models**. | Run without limits: a pause between trainings, plus a daily training limit, daily Try models calls and 3 adapter starts per day, which reset at 00:00 UTC. |

Things that bite if we get them wrong:

- **Changing the system prompt creates a new task** and the example count starts again at zero. Everything
  that varies (goal, page, demonstrations) goes in the **user message**.
- Numbers, dates and IDs in the system prompt don't split a task; other changing words do.
- `examples too long to train on` fails training → keep the page input short (interactive elements only).
- Send `metadata.session_id` on every call (one per browser run). Mubit sets test cases aside by session.
- Mubit trains on **the provider's reply**, not on an answer we attach. See [the correction mechanic](#the-correction-mechanic).
- The first adapter start in Try models takes several minutes. Warm it up before the demo.

---

## How it works

```
 voice ──► goal text
              │
              ▼
 ┌──────────────────────────── agent loop (one run = one session_id) ───────────────────────────┐
 │  extension reads page ─► trim to interactive elements ─► next-action call ─► do the action   │
 │                                                    │                                          │
 │                                              done-check call                                  │
 └──────────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                                │ failed?
                                                ▼
                       "Show me" ─► human does the task, recorder logs each step
                                                │
                       ┌────────────────────────┴────────────────────────┐
                       ▼                                                 ▼
           MemStack (our memory)                               Mubit (training)
           store demo steps, inject them                       re-send each step as a call of the
           into the rerun's user message                       next-action task → kept examples
                       │                                                 │
                       ▼                                                 ▼
               rerun succeeds live                       adapter v1 → v2, tested vs provider,
                                                         shown in Try models + our ledger
```

All LLM calls go through Mubit, from our backend (Mubit refuses browser calls, and the key must stay off the client).
Voice-to-text and the extension's page reading are not LLM calls and stay outside it.

**Built as a Chrome extension** (side panel + content script) with a small Node backend. Run and test it: [TESTING.md](../TESTING.md).

### The three Mubit tasks

Each has one fixed system prompt, so Mubit sees exactly three tasks. Outputs are tiny JSON.

| Task | User message (varies) | Output |
| --- | --- | --- |
| **next-action** | goal + trimmed accessibility tree + recalled demonstrations (if any) | `{"action": "click" \| "type" \| "select" \| "done", "element_id": "e37", "value": "..."}` |
| **done-check** | goal + trimmed tree after the action | `{"done": true, "reason": "..."}` |
| **safety-gate** | pending action + element label | `{"allow": false, "reason": "irreversible: pay"}` |

**next-action** is the one we train and demo. The other two add volume and make the agent believable.

### The correction mechanic

Because Mubit trains on what the provider replies, a correction has to become a call where the provider
gives the right answer. For each demonstrated step:

1. Recorder captures `{goal, trimmed tree, action, element_id, value}`.
2. We build the next-action user message: goal + tree + a **recalled demonstration** block that contains
   the human's action for this page.
3. We send it through Mubit with the normal next-action system prompt. The provider replies with that action,
   and Mubit records the pair as an example of the next-action task.

An 8-click demonstration gives 8 examples.

**Be honest about this on stage (and in Q&A):** the adapter learns *"pick the next action, using any recalled
demonstrations"*. That matches how the product runs: MemStack always injects recalled demos when it has
them. The adapter does not learn the page from a demo it never sees. If a judge asks "did the model learn,
or did you give it the answer?", the answer is: the live rerun uses our memory layer; Mubit turns those
runs into a small model that does the same decision for a twentieth of the cost; the adapter can't drive
the agent yet because Mubit doesn't serve adapters.

We also need plenty of **demo-free** next-action calls (normal successful runs). Without them the adapter
only learns to copy hints.

---

## The 3-minute demo

| Time | What happens | What the judges see |
| --- | --- | --- |
| 0:00 | Say: "Book a table for two at eight." | Agent clicking on the projector, decision panel beside it. |
| 0:40 | Agent picks the wrong date field; done-check fails; agent says "show me". | Red step in the run timeline (the autopsy). |
| 1:00 | We do it by hand, once. | Each click appears as a recorded step: "8 examples → Mubit". |
| 1:40 | Same command, rerun. | It books the table. |
| 2:10 | Ledger: next-action task, kept examples, v1 → v2 passed, match %. Try models: provider vs adapter on this page. | Cost per 1k decisions, p50 latency, projected monthly saving. |
| 2:45 | "Every fix your team makes becomes a model you own." | — |

**Fallbacks:** typed command if voice fails; a prerecorded video of the whole run; Try models
screenshots in case adapter start-up stalls.

---

## How we score (judging criteria, equal weight)

| Criterion | Our score (realistic / clean) | What wins the point |
| --- | --- | --- |
| Use of Mubit | 9 / 9 | A correction visibly becoming a new adapter version. Say out loud which part is our memory and which is Mubit. |
| Usefulness | 8 / 8 | Browser agents breaking on real sites is a daily, expensive problem. |
| Technical execution | 6 / 9 | Four moving parts. Keep the decision step small and have real v1 vs v2 numbers. |
| Demo | 9 / 10 | Voice → fail → teach → succeed → ledger. Prerecord a fallback. |
| **Total** | **32 / 36** of 40 | |

---

## Build plan

The critical path is **the first adapter**, not the UI. Two training windows before Sunday (resets 00:00 UTC).

**Friday night (tonight)**
- [ ] Get Mubit keys; confirm the **Adapters** page and **Try models** are on for our workspace.
- [ ] Ask the crew the [open questions](#open-questions-ask-the-mubit-crew) at the 18:00 walkthrough.
- [x] Lock the three system prompts and JSON schemas (`server/prompts.js`; `npm test` fails if they change). **Don't change them after this.**
- [ ] Pick 2–3 target flows on a site we control or a stable demo site (form, search, booking). Booking is built: `server/demo-site/`.
- [x] Chrome extension: read page → trimmed element list → next-action through Mubit → act.
- [ ] Traffic script: run many episodes so next-action passes 25 kept examples before 00:00 UTC. Built: `npm run seed` (needs the Mubit key).

**Saturday**
- [x] Recorder: capture human clicks/typing against the tree, not pixels.
- [x] Demo re-send → Mubit; MemStack store + recall into the rerun.
- [x] Run timeline ("autopsy") UI and ledger (versions, match %, cost, latency).
- [x] Voice input (Chrome speech API; Wispr Flow works by typing into the goal box), with a typed fallback.
- [ ] Push corrected demonstrations to force **v2**; get a passing version in Try models.

**Sunday 08:00–10:00**
- [ ] Warm up the adapter in Try models (first start takes minutes, 3 starts per day).
- [ ] Rehearse twice end to end; record the fallback video.

### Who owns what

| Area | Owner |
| --- | --- |
| Extension + recorder | _TBD_ |
| Mubit loop (prompts, traffic script, re-send, ledger data) | _TBD_ |
| UI (decision panel, timeline, ledger) + voice | _TBD_ |
| Pitch + demo script | _TBD_ |

**If nobody can own the extension tonight, switch to Plan B** (below). The browser part is what sinks the
technical score.

---

## Open questions (ask the Mubit crew)

1. **How does a correction become training data?** Is re-sending the call (provider replies with the right
   answer) the intended path? Does the Good/Bad rating affect kept examples or training? Is there anything
   the hackathon build unlocks?
2. **Can hackers route live calls to an adapter?** If yes, the agent can run on the model it trained,
   and our story gets much stronger.
3. **Time to first adapter** after 25 kept examples, and how many trainings per day we get.
4. **How long is too long?** A size limit for one example, so we can trim the accessibility tree to fit.
5. Do tool calls (function calling) train better than JSON-in-text for next-action?

---

## Plan B — if Show Me is too much

Same stack, fewer moving parts: **live inbox triage**. Put a QR code / number on screen, judges send
messages, each one is classified (`{category, urgency, route, reply_draft}`) through Mubit, a judge
disagrees, we override, and the ledger shows v1 → v2. Optional 60-second party-game round as the opening
hook. Rubric score is about 36/40 with a much higher floor. Keep Show Me as the "where this goes next" slide.

## Ideas we ruled out, and why

- **Screenshot computer-use agent**: Mubit can't train on images, and the cool part (the cursor) has nothing to do with Mubit.
- **Memory / guardrail / "lessons" systems**: those features aren't in Mubit; we'd be building them and bolting Mubit on.
- **Browser-history learning**: history has URLs, not clicks or values, so there's nothing to train on, and it raises privacy questions.
- **Plain support-ticket triage**: it's the Mubit docs' own example; half the room will build it.
