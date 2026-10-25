# GP Front Door Voice

A patient speaks (or types) a request to a GP practice and hears a reply in about a second.
Red-flag safety rules run first with no AI; otherwise one Mubit call picks one of 7 routes and says how sure it is.
A care navigator sees every request in an inbox and can OK it or change the route; every change is logged as a training signal.

**Demo only - not medical advice.** All seed data is synthetic.

## Run it

```bash
cd archive/gp-front-door-voice
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # then put your Mubit key in .env
.venv/bin/uvicorn main:app --port 8103
```

Open http://127.0.0.1:8103/ in Chrome (voice needs Chrome or Edge; the text box works everywhere).
`http://127.0.0.1:8103/?q=Can%20I%20book%20a%20flu%20jab` sends a typed request on load.

- Tests (no network, the OpenAI client is mocked): `.venv/bin/python -m pytest -q`
- Seed Mubit with examples: `.venv/bin/python seed.py` is a dry run; `.venv/bin/python seed.py --send --n 30` sends 30.
  Use `--start 30` next time to send different rows.

## How it works

1. **Red flags first, no AI.** A short rule list (`triage.py`, `RED_FLAGS`): chest pain, can't breathe, stroke signs,
   heavy bleeding, collapse or fit, severe allergy, a rash that does not fade, suicidal thoughts. A match answers
   straight away with the 999/111 message and is marked `rule`.
2. **Otherwise one Mubit call.** It returns `{"route": ..., "reply": ..., "sure": "high|medium|low"}` with one of
   `same_day_gp, routine_gp, nurse, pharmacist, admin, self_care, urgent_111`. The browser speaks the reply as soon as it arrives.
3. **Unsure goes to a person.** `sure: low` (or an answer that does not parse) is flagged "needs a person" at the top of the inbox.
4. **The navigator reviews.** Accept/OK or Fix/Change route writes one JSON line to `data/corrections.jsonl`
   (trace id, input, model answer, final answer, accepted or fixed, time).

## How Mubit is used

- Every call goes through `https://api.mubit.ai/openai/v1` with model `gpt-6-luna`.
- **One clean task:** the system prompt is one constant (`SYSTEM_PROMPT`), the output is always the same JSON shape
  (`response_format: json_object`), no tools, same model. Only the patient's words change, and they go in the user message.
  So Mubit groups every call into one task and can train a small model (an adapter) on it after about 25 kept examples.
- **`store` is off by default.** On Mubit's starter credit, `store: true` is rejected (HTTP 400 `starter_credit_option`),
  and the provider only accepts `metadata` together with `store`. Set `MUBIT_STORE=1` in `.env` once an own OpenAI key is
  added under Provider keys in the Mubit console; then calls also send `metadata.session_id` per browser session.
  Mubit still records every call in Requests without it.
- The app reads the response headers: `x-middleware-served-by` (contains `vllm` = Mubit's small model answered,
  otherwise the big model) and `x-middleware-trace` (the `trc_...` id). Starter-credit calls (seen 24 Oct) carry neither header,
  only `x-middleware-request-id` (`mreq_...`), so the app shows that id instead and counts the call as big model.
  The page shows small/big model, latency and the short id for every answer, plus counters: calls, % small model,
  average latency, accepts, fixes.
- **Corrections:** `send_correction(trace_id, final_answer)` in `corrections.py` is the single place where a navigator fix
  would go to Mubit. Mubit's public correction API is not known yet, so for now it only records locally.

## Seed data

`data/seed_requests.jsonl`: 150 synthetic patient requests written for this project (no real patient data), each labelled
with its right route. They cover coughs, rashes, contraception, pregnancy tests, repeat medicines, sick notes, back pain,
child fever, mental health, travel jabs, test results and more. `seed.py` replays them through the app's own call path
(`main.handle_request`) and skips the red-flag rows, because those never reach Mubit.
First run (24 Oct, `--n 30`): the big model matched the label on 26 of 30, at about 1.3 to 3.3 s per call.

## 3-minute demo script

1. **(0:00)** Open the page. Point at the "Demo only" note and the counters strip. Say: "20,000 requests a day hit GP front doors. This answers each one in about a second."
2. **(0:15)** Press the mic and say: "I need a sick note, I've been off work for a week with flu." The reply is spoken back. Point at the route (Admin), "sure: high", the latency and "small model" or "big model".
3. **(0:40)** Press the mic and say: "I've got crushing chest pain going down my arm." It answers at once with the 999 message, marked "rule". Say: "Safety rules run before any AI. No model decides an emergency."
4. **(1:00)** Type: "It's about my mum, she's not herself." It comes back "sure: low" and jumps to the top of the navigator inbox as "needs a person".
5. **(1:20)** In the navigator inbox, change one route (for example a pharmacist request the model sent to routine GP). The Fixes counter goes up. Open `data/corrections.jsonl` and show the line: trace id, model answer, final answer.
6. **(1:50)** Say: "Every fix is a training signal. Mubit already groups these calls into one task. After about 25 kept examples it trains a small model, tests it against the big one, and starts serving it."
7. **(2:10)** Ask the same kind of request again and point at "small model" and the lower latency (once Mubit serves the adapter). Point at "% small model" in the counters.
8. **(2:40)** Close: "Red flags first, a person for anything unsure, and a model that gets faster and cheaper with every fix your navigators make."

**Fallbacks:** type instead of speaking; if Mubit is slow, the rule path (step 3) and the inbox still work.

## Limits (v0)

- The inbox is in memory and resets when the server restarts; `data/corrections.jsonl` keeps the reviews.
- Red-flag rules are simple keyword patterns. They err on the safe side and do not understand "no chest pain".
- No login, database or hosting.
