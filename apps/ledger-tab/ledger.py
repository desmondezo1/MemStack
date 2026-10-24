"""Ledger Tab core: seed data, the Mubit call, answer parsing and the correction log."""

import csv
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
CORRECTIONS_PATH = DATA / "corrections.jsonl"

MUBIT_BASE_URL = "https://api.mubit.ai/openai/v1"
MODEL = "gpt-6-luna"
# Mubit's starter credit rejects store=True (400 starter_credit_option), and the provider rejects metadata
# without store. Mubit still records every call; set MUBIT_STORE=1 once our own provider key is added
# in the Mubit console, which also sends metadata.session_id.
STORE = os.environ.get("MUBIT_STORE") == "1"

CHART = json.loads((DATA / "chart.json").read_text())
ACCOUNTS = {a["code"]: a["name"] for a in CHART["accounts"]}
TAX_CODES = {t["code"]: t["name"] for t in CHART["tax_codes"]}
CLIENTS = {c["id"]: c for c in json.loads((DATA / "clients.json").read_text())}

# One fixed system prompt, so Mubit groups every call into one task.
# Anything that changes per call (client, profile, line, past decisions) goes in the user message.
SYSTEM_PROMPT = "\n".join(
    [
        "You are a UK bookkeeper. You code one business bank statement line for one client.",
        "Pick the ledger account and the VAT tax code for the line.",
        "Use the client profile and the client's past decisions; clients code the same merchant differently.",
        "",
        "Chart of accounts:",
        *(f"{code} {name}" for code, name in ACCOUNTS.items()),
        "",
        "Tax codes:",
        *(f"{code} {name}" for code, name in TAX_CODES.items()),
        "",
        "Reply with JSON only, in exactly this shape:",
        '{"account": "<code from chart>", "tax": "<tax code>", "sure": "high|medium|low"}',
    ]
)


def load_lines(path=DATA / "lines.csv"):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def merchant_key(description):
    """First two words of a bank description, so 'TESCO STORES 2041' matches 'TESCO STORES 3317'."""
    return " ".join(re.findall(r"[A-Z]+", description.upper())[:2])


def read_corrections(path=None):
    path = Path(path or CORRECTIONS_PATH)
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def last_decision(client_id, description, path=None):
    """The client's latest final answer for a line from the same merchant, or None."""
    key = merchant_key(description)
    for entry in reversed(read_corrections(path)):
        line = entry["input"]["line"]
        if entry["input"]["client_id"] == client_id and merchant_key(line["description"]) == key:
            return {"description": line["description"], **entry["final_answer"]}
    return None


def build_user_message(client, line, decision=None):
    parts = [f"Client: {client['id']} ({client['name']})", f"Profile: {client['profile']}"]
    if decision:
        parts.append(
            f"Last decision for a similar line: {decision['description']} -> "
            f"{decision['account']} / {decision['tax']}"
        )
    parts.append(f"Bank line: {line['date']} | {line['description']} | {line['amount']}")
    return "\n".join(parts)


def parse_answer(text):
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    account = str(data.get("account", "")).strip().split(" ")[0]
    tax = str(data.get("tax", "")).strip().upper()
    sure = str(data.get("sure", "")).strip().lower()
    return {
        "account": account if account in ACCOUNTS else None,
        "tax": tax if tax in TAX_CODES else None,
        "sure": sure if sure in ("high", "medium", "low") else "low",
        "valid": account in ACCOUNTS and tax in TAX_CODES,
    }


def parse_headers(headers):
    # Provider-served calls came back without served-by or trace headers (seen 24 Oct),
    # so fall back to Mubit's request id to still name the call.
    served_by = headers.get("x-middleware-served-by") or ""
    return {
        "served_by": served_by,
        "small": "vllm" in served_by.lower(),
        "trace_id": headers.get("x-middleware-trace") or headers.get("x-middleware-request-id") or None,
    }


def make_llm():
    from openai import OpenAI

    key = os.environ.get("MUBIT_API_KEY")
    if not key:
        raise RuntimeError("MUBIT_API_KEY is not set (add it to apps/ledger-tab/.env)")
    return OpenAI(api_key=key, base_url=MUBIT_BASE_URL)


def ask_mubit(llm, user_message, session_id):
    start = time.perf_counter()
    raw = llm.chat.completions.with_raw_response.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        response_format={"type": "json_object"},
        **({"store": True, "metadata": {"session_id": session_id}} if STORE else {}),
    )
    latency_ms = round((time.perf_counter() - start) * 1000)
    text = raw.parse().choices[0].message.content or ""
    return {**parse_answer(text), **parse_headers(raw.headers), "latency_ms": latency_ms}


def suggest(llm, line, session_id, corrections_path=None):
    """The one call path for a bank line, used by the app and by seed.py."""
    client = CLIENTS[line["client_id"]]
    decision = last_decision(client["id"], line["description"], corrections_path)
    user_message = build_user_message(client, line, decision)
    return {**ask_mubit(llm, user_message, session_id), "user_message": user_message}


def make_correction(line, suggestion, final_answer):
    model_answer = {"account": suggestion["account"], "tax": suggestion["tax"]}
    return {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "trace_id": suggestion.get("trace_id"),
        "input": {
            "client_id": line["client_id"],
            "line": {k: line[k] for k in ("id", "date", "description", "amount")},
            "user_message": suggestion.get("user_message"),
        },
        "model_answer": {**model_answer, "sure": suggestion.get("sure")},
        "final_answer": final_answer,
        "outcome": "accepted" if final_answer == model_answer else "fixed",
        "served_by": suggestion.get("served_by"),
    }


def log_correction(entry, path=None):
    path = Path(path or CORRECTIONS_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(entry) + "\n")


def send_correction(trace_id, final_answer):
    # Mubit's public correction API is still unknown, so for now the local log is the only record.
    return False


class Stats:
    def __init__(self):
        self.calls = self.small = self.latency_total = self.accepts = self.fixes = 0

    def add_call(self, result):
        self.calls += 1
        self.small += bool(result.get("small"))
        self.latency_total += result.get("latency_ms", 0)

    def add_outcome(self, outcome):
        if outcome == "accepted":
            self.accepts += 1
        else:
            self.fixes += 1

    def to_dict(self):
        decided = self.accepts + self.fixes
        return {
            "calls": self.calls,
            "small_pct": round(100 * self.small / self.calls) if self.calls else 0,
            "avg_ms": round(self.latency_total / self.calls) if self.calls else 0,
            "accepts": self.accepts,
            "fixes": self.fixes,
            "accept_rate": round(100 * self.accepts / decided) if decided else 0,
        }
