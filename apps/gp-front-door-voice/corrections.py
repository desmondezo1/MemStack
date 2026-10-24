"""Navigator reviews: every OK and every route change is one JSON line."""

import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from triage import ROUTE_REPLIES

CORRECTIONS_PATH = Path(__file__).resolve().parent / "data" / "corrections.jsonl"

_lock = threading.Lock()


def build_record(item, outcome, final_answer):
    return {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "trace_id": item.get("trace_id", ""),
        "input": item["text"],
        "model_answer": {
            "route": item.get("route", ""),
            "reply": item.get("reply", ""),
            "sure": item.get("sure", ""),
            "served_by": item.get("served_by", ""),
        },
        "final_answer": final_answer,
        "outcome": outcome,
    }


def final_answer_for(item, outcome, new_route=None):
    """Accept keeps the model's answer; a fix uses the new route and its fixed reply."""
    if outcome == "accepted":
        return {"route": item.get("route", ""), "reply": item.get("reply", ""), "sure": item.get("sure", "")}
    return {"route": new_route, "reply": ROUTE_REPLIES[new_route], "sure": "high"}


def append_correction(record, path=None):
    path = Path(path or CORRECTIONS_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False)
    with _lock, path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def read_corrections(path=None):
    path = Path(path or CORRECTIONS_PATH)
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def send_correction(trace_id, final_answer):
    # Mubit's public correction API is still unknown, so this only records locally.
    return {"sent_to_mubit": False, "trace_id": trace_id}


def record_review(item, outcome, new_route=None, path=None):
    final_answer = final_answer_for(item, outcome, new_route)
    record = build_record(item, outcome, final_answer)
    append_correction(record, path)
    send_correction(record["trace_id"], final_answer)
    return record
