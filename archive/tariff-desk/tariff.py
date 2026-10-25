"""Tariff Desk core: one fixed Mubit task, answer parsing, and the call and correction logs."""

import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
CALLS_LOG = DATA_DIR / "calls.jsonl"
CORRECTIONS_LOG = DATA_DIR / "corrections.jsonl"

MUBIT_BASE_URL = "https://api.mubit.ai/openai/v1"
MODEL = "gpt-6-luna"

# One fixed system prompt for every call, so Mubit sees one task. Anything that changes per call
# (the product, the client) goes in the user message, never here.
SYSTEM_PROMPT = """You are a customs classification assistant working for a customs broker.
You get one product description. Return the 6-digit Harmonized System (HS) subheading for it.
Apply the General Rules of Interpretation in order: the terms of the headings and the section and chapter notes first, then essential character.
Reply with one JSON object and nothing else, in exactly this shape:
{"hs6": "<6 digits, no dots or spaces>", "reason": "<one or two short sentences naming the heading and why>", "sure": "high" | "medium" | "low"}
Use "low" when facts that decide the code (material, knitted or woven, use) are missing from the description."""

SURE_LEVELS = ("high", "medium", "low")


def make_client(max_retries=2):
    """Build an OpenAI client pointed at Mubit, reading MUBIT_API_KEY from .env or the environment."""
    from openai import OpenAI

    load_dotenv(APP_DIR / ".env")
    key = os.environ.get("MUBIT_API_KEY")
    if not key:
        raise RuntimeError("MUBIT_API_KEY is not set. Copy .env.example to .env and add your key.")
    return OpenAI(api_key=key, base_url=MUBIT_BASE_URL, max_retries=max_retries)


def build_messages(description):
    """System prompt stays fixed; the product description goes only in the user message."""
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Product description:\n{description.strip()}"},
    ]


def normalize_hs6(value):
    """Return the first 6 digits of a code such as '6109.10' or '6109.10.0012', or None."""
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[:6] if len(digits) >= 6 else None


def parse_answer(text):
    """Parse the model's JSON reply into {hs6, reason, sure}. Raises ValueError on a bad reply."""
    try:
        data = json.loads(text)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError(f"reply is not JSON: {text!r}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"reply is not a JSON object: {text!r}")
    hs6 = normalize_hs6(data.get("hs6"))
    if hs6 is None:
        raise ValueError(f"reply has no 6-digit hs6: {text!r}")
    sure = str(data.get("sure", "")).strip().lower()
    return {
        "hs6": hs6,
        "reason": str(data.get("reason", "")).strip(),
        "sure": sure if sure in SURE_LEVELS else "low",
    }


def parse_headers(headers):
    """Read who served the call and its trace id from Mubit's response headers."""
    lower = {k.lower(): v for k, v in headers.items()}
    served_by = lower.get("x-middleware-served-by", "")
    trace_id = lower.get("x-middleware-trace") or lower.get("x-middleware-request-id") or ""
    return {
        "served_by": served_by,
        "small_model": "vllm" in served_by.lower(),
        "trace_id": trace_id,
    }


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def append_jsonl(path, record):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def read_jsonl(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def classify(client, description, source="ui"):
    """Send one product description through Mubit and log the call. This is the only call path."""
    started = time.perf_counter()
    raw = client.chat.completions.with_raw_response.create(
        model=MODEL,
        messages=build_messages(description),
        response_format={"type": "json_object"},
        # No `store` or `metadata`: Mubit records every call by default, the starter credit refuses
        # store=True, and OpenAI refuses metadata without store.
    )
    latency_ms = round((time.perf_counter() - started) * 1000)
    completion = raw.parse()
    answer = parse_answer(completion.choices[0].message.content)
    info = parse_headers(raw.headers)
    record = {
        "trace_id": info["trace_id"] or f"local_{uuid.uuid4().hex[:16]}",
        "input": description.strip(),
        "answer": answer,
        "served_by": info["served_by"],
        "model": completion.model,
        "small_model": info["small_model"],
        "latency_ms": latency_ms,
        "source": source,
        "time": now_iso(),
    }
    append_jsonl(CALLS_LOG, record)
    return record


def find_call(trace_id):
    for call in reversed(read_jsonl(CALLS_LOG)):
        if call["trace_id"] == trace_id:
            return call
    return None


def send_correction(trace_id, final_answer):
    # Mubit's public correction API is still unknown, so for now the correction is only recorded locally.
    return False


def record_feedback(call, final_hs6):
    """Write one accept or fix as a JSON line, then hand it to send_correction."""
    hs6 = re.sub(r"\D", "", str(final_hs6 or ""))
    if len(hs6) != 6:
        raise ValueError("the final code must be exactly 6 digits")
    final_answer = {**call["answer"], "hs6": hs6}
    if hs6 != call["answer"]["hs6"]:
        final_answer["reason"] = "Fixed by the broker."
        final_answer["sure"] = "high"
    entry = {
        "trace_id": call["trace_id"],
        "input": call["input"],
        "model_answer": call["answer"],
        "final_answer": final_answer,
        "verdict": "accepted" if hs6 == call["answer"]["hs6"] else "fixed",
        "time": now_iso(),
    }
    append_jsonl(CORRECTIONS_LOG, entry)
    entry["sent_to_mubit"] = send_correction(call["trace_id"], final_answer)
    return entry


def stats():
    calls = read_jsonl(CALLS_LOG)
    feedback = read_jsonl(CORRECTIONS_LOG)
    small = sum(1 for c in calls if c["small_model"])
    return {
        "calls": len(calls),
        "small_pct": round(100 * small / len(calls)) if calls else 0,
        "avg_latency_ms": round(sum(c["latency_ms"] for c in calls) / len(calls)) if calls else 0,
        "accepts": sum(1 for f in feedback if f["verdict"] == "accepted"),
        "fixes": sum(1 for f in feedback if f["verdict"] == "fixed"),
    }


def history(limit=20):
    """Newest UI calls first, each with the broker's latest verdict if there is one."""
    verdicts = {f["trace_id"]: f for f in read_jsonl(CORRECTIONS_LOG)}
    rows = [c for c in read_jsonl(CALLS_LOG) if c["source"] == "ui"][-limit:]
    out = []
    for call in reversed(rows):
        fb = verdicts.get(call["trace_id"])
        out.append({
            **call,
            "verdict": fb["verdict"] if fb else None,
            "final_hs6": fb["final_answer"]["hs6"] if fb else None,
        })
    return out
