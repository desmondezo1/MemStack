# Ledger Tab

A bookkeeper codes a client's bank statement lines. For each line the app suggests the ledger account
and VAT code as grey ghost text: Tab accepts it, a dropdown fixes it. Every suggestion is one call to
the same Mubit task, and every accept or fix is logged, so a small model can learn each client's habits.

## Run it

```sh
cd archive/ledger-tab
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # then put your Mubit key in .env
.venv/bin/python seed.py        # dry run: shows the rows it would send
.venv/bin/python seed.py --send --n 30   # 30 paid calls: past months, so Mubit gets examples
.venv/bin/uvicorn app:app --port 8102
```

Open http://127.0.0.1:8102. Tests (no network, the OpenAI client is faked): `.venv/bin/python -m pytest -q tests`.

Keys: <kbd>Tab</kbd> accept and go to the next line, <kbd>Shift</kbd>+<kbd>Tab</kbd> go back,
change a dropdown then <kbd>Tab</kbd> (or Save fix) to record a fix. "Suggest next 10" fetches a batch;
otherwise the app only asks for the active line and the two after it, to save credit.

## How Mubit is used

- **One task.** Every call uses `gpt-6-luna`, the same system prompt (`SYSTEM_PROMPT` in `ledger.py`,
  which holds the chart of accounts and tax codes), JSON output (`response_format` `json_object`,
  shape `{"account", "tax", "sure"}`) and no tools. The client, its profile, the bank line and the
  client's last decision for the same merchant go in the user message, never the system prompt.
- **Which model answered.** The app reads the raw response headers: `x-middleware-served-by` containing
  `vllm` means Mubit's small model answered, otherwise the big model. Each row shows that, the
  wall-clock latency and a short trace id (`x-middleware-trace`, or `x-middleware-request-id` when the
  trace header is missing, which is what provider-served calls returned on 24 Oct).
- **`store`.** Mubit's starter credit rejects `store=True` (400 `starter_credit_option`), and the provider
  rejects `metadata` without `store`. So both are off by default; set `MUBIT_STORE=1` once a provider key
  is added in the Mubit console. Mubit records every call either way.
- **Corrections.** Each accept or fix is one JSON line in `data/corrections.jsonl` (trace id, input, model
  answer, final answer, accepted or fixed, time). `send_correction()` is the hook for sending it to Mubit;
  Mubit has no public correction API yet, so it only keeps the local record. Mubit trains on the provider's
  reply, so a fix reaches the model this way: the next call for that merchant carries the fix as the
  client's last decision, the provider answers right, and that call is a new training example.
- **Counters** (top right): calls, % answered by the small model, average latency, accepts, fixes, accept
  rate, since the server started.

## Data

All seed data is synthetic, made for this demo: two made-up clients (`data/clients.json`), a small UK-style
chart of accounts and VAT codes (`data/chart.json`), and 144 bank lines (`data/lines.csv`) for July to
September 2026. Merchant names are only description text. The clients code some merchants differently on
purpose (Amazon is packaging for the bakery but stationery for the studio; Tesco is stock for one and
staff welfare for the other). July and August are `history` (used by `seed.py`); September is the
`statement` the app shows. To reset, stop the server and delete `data/corrections.jsonl`.

## 3-minute demo

1. **0:00** Open the app on Oven Lane Bakery. "A bookkeeper codes every bank line for every client. The grey
   text is a suggestion from one Mubit task."
2. **0:20** Press Tab four or five times. Rows turn green and the counters climb. Point at the model badge,
   the ms and the trace id on each row.
3. **0:50** Stop on a line the model got wrong (in our run the bakery's first Tesco shop came back as
   drawings). Pick the right account and tax code from the dropdowns, press Tab. "That fix is logged with
   its trace id."
4. **1:10** Tab down to the next line from the same merchant. It now suggests the fixed coding, because the
   client's last decision travels in the user message, and that call is a fresh training example for Mubit.
5. **1:35** Switch the client to Pixel Yard Design. Tesco, Amazon, Shell and Pret go to different accounts
   here. "Same merchant, different habit. That is exactly what a small per-task model can learn."
6. **2:00** Show the Mubit console: the one task, its example count and adapter status. When an adapter
   passes, rows flip to "small model", the ms drop and the small-model % climbs.
7. **2:40** Close: "Our app keeps each client's corrections; Mubit turns the calls they shape into a small
   model that codes lines faster and cheaper."
