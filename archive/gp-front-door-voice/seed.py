"""Replay seed requests through the app's own call path so Mubit gets examples.

Dry run by default. Nothing goes to Mubit unless you pass --send.
    python seed.py                # show what would be sent
    python seed.py --send --n 30  # send 30 requests to Mubit
"""

import argparse
import json
import random
import uuid
from pathlib import Path

import triage
from main import handle_request

SEED_PATH = Path(__file__).resolve().parent / "data" / "seed_requests.jsonl"


def load_rows(path=SEED_PATH):
    with Path(path).open(encoding="utf-8") as handle:
        rows = [json.loads(line) for line in handle if line.strip()]
    # Fixed shuffle so the first rows cover every route.
    random.Random(7).shuffle(rows)
    return rows


def pick_rows(rows, n, start=0):
    """Rows the model would see: red-flag rows never reach Mubit, so skip them."""
    model_rows = [row for row in rows if not triage.check_red_flags(row["text"])]
    return model_rows[start : start + n]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--send", action="store_true", help="really send to Mubit")
    parser.add_argument("--n", type=int, default=30, help="how many requests to send (default 30)")
    parser.add_argument("--start", type=int, default=0, help="skip this many rows first (default 0)")
    args = parser.parse_args(argv)

    rows = pick_rows(load_rows(), args.n, args.start)
    if not args.send:
        print(f"Dry run: would send {len(rows)} requests. Add --send to send them.")
        for row in rows[:5]:
            print(f"  [{row['route']}] {row['text']}")
        return 0

    session_id = "seed-" + uuid.uuid4().hex[:8]
    matched = small = 0
    for number, row in enumerate(rows, 1):
        try:
            item = handle_request(row["text"], source="seed", session_id=session_id)
        except Exception as err:  # Stop at the first failure so a bad key does not burn the batch.
            print(f"Stopped at row {number}: {type(err).__name__}: {err}")
            rows = rows[: number - 1]
            break
        matched += item["route"] == row["route"]
        small += item["served_by"] == "small"
        mark = "ok " if item["route"] == row["route"] else "MISS"
        print(
            f"{number:3d} {mark} label={row['route']:<12} model={item['route'] or '-':<12} "
            f"sure={item['sure']:<6} {item['served_by']:<5} {item['latency_ms']:>5} ms {item['trace_short']}"
        )
    total = len(rows)
    if total:
        print(f"Sent {total}. Route matched label: {matched}/{total}. Small model: {small}/{total}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
