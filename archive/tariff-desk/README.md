# Tariff Desk

A customs broker types a product description and gets back a 6-digit HS tariff code, a short reason and how sure the model is.
The broker accepts the code or fixes it. Every accept and fix is logged as a training signal.
All calls go through [Mubit](https://docs.mubit.ai), which trains a small model on this one task and routes more calls to it over time.

## Run it

```sh
cd archive/tariff-desk
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # then put your Mubit key in .env
.venv/bin/python app.py       # http://127.0.0.1:8101
```

Tests (no network, the OpenAI client is faked):

```sh
.venv/bin/python -m pytest -q tests
```

Seed Mubit and score the app. Both scripts do nothing without `--send`, and every row is one paid call:

```sh
.venv/bin/python seed.py --send --n 30    # replay seed rows so Mubit gets examples
.venv/bin/python eval.py --send --n 20    # score on held-out rows
```

## How Mubit is used

- **One clean task.** Every call uses the same model (`gpt-6-luna`), the same fixed system prompt (`SYSTEM_PROMPT` in `tariff.py`), the same JSON output shape (`{"hs6", "reason", "sure"}` with `response_format: json_object`) and no tools. The product description only goes in the user message, so Mubit groups every call into one task.
- **Kept and trainable.** Mubit records every call by default. The call sends no `store` flag: the starter credit refuses `store=True`, and OpenAI refuses `metadata` without it.
- **Who answered.** The app reads the response headers on every call. If `x-middleware-served-by` contains `vllm`, Mubit's small model answered; otherwise the big model did. The trace id comes from `x-middleware-trace`, or `x-middleware-request-id` when that is missing. On 24 Oct, big-model answers came back without `x-middleware-served-by` or `x-middleware-trace`, so a missing served-by header counts as big model. The page shows small or big model, the latency in ms and the short trace id for each answer.
- **Corrections.** Accept and Fix write one line each to `data/corrections.jsonl` (trace id, input, model answer, final answer, verdict, time). The hand-off to Mubit sits behind `send_correction()` in `tariff.py`. Mubit has no public correction API yet, so for now it only records locally.
- **Counters.** The strip at the top shows calls, % small model, average latency, accepts and fixes. Calls are logged to `data/calls.jsonl`, so seed and eval runs count too.

## Seed data

`data/seed.jsonl` (137 rows) and `data/heldout.jsonl` (40 rows) come from the public
[CROSS Rulings HTS Dataset](https://huggingface.co/datasets/Dayanand314Krishna/cross_rulings_hts_dataset_for_tariffs)
(Apache-2.0, by Flexify.AI), which is built from U.S. Customs and Border Protection rulings (CROSS).
Seed rows are from its `validation` split and held-out rows from its `test` split.
We kept rulings with exactly one HTS code, turned each question into a plain product description, and dropped rows that name a brand or a company.
`hs6` is the first 6 digits of the ruling's 10-digit US code.

Note: eval calls go through the same task, so held-out rows also become Mubit examples once they are sent.

## Baseline (big model, before any adapter)

`eval.py --send --n 20` on 24 Oct 2026: 14/20 exact 6-digit (70%), 17/20 first 4 digits (85%), 0/20 small model, 4951 ms average latency.
`seed.py --send --n 25` matched 17/25 exact. Re-run the eval after Mubit trains an adapter to show the change.

## 3-minute demo

1. Open http://127.0.0.1:8101. Point at the counters: every call so far went through Mubit, and the strip shows how many the small model answered.
2. Click the chip **T-shirt with horses on it** and press Classify. The model gives a code with low or medium confidence, because the description does not say knitted or woven, or cotton or not.
3. Read the answer card: the code, the reason, how sure it is, which model answered (big model at first), the latency and the trace id.
4. Click **Fix**, type the broker's code (for a knitted cotton T-shirt, `610910`) and save. Say: this fix is a training signal, logged against the trace id of the call it corrects.
5. Click the chip **Men's T-shirt, 100% cotton jersey knit, printed with horses** and classify. Expect `6109.10` with high confidence. Click **Accept**.
6. Click **Cast iron doorstop shaped like a horse**. In testing the model said `8302.41` (door fittings). A public CBP ruling put a decorative cast iron doorstop under `7323.91` (household articles of cast iron). Fix it to `732391`: this is the broker's own call, which the model should learn.
7. Show the history list: each row has the code (a fix shows the old code struck out), small or big model, the latency and the verdict.
8. Close on the counters: as Mubit's small model takes over this task, the small-model share goes up and the average latency goes down. Mention the eval: `eval.py --send --n 20` scores exact 6-digit and 4-digit matches on held-out rulings.
