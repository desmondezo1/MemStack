"""Replay past months of seed bank lines through the app's own call path, so Mubit gets examples.

Dry run by default. Pass --send to call Mubit (each row is one paid call).
Each answer is then checked against the seed's known coding and logged as an accept or a fix,
which also gives the app each client's past decisions.
"""

import argparse
import time
from itertools import chain, zip_longest

from dotenv import load_dotenv

import ledger


def history_rows(n):
    """Up to n past-month rows, alternating between clients so both get examples."""
    by_client = {}
    for line in ledger.load_lines():
        if line["set"] == "history":
            by_client.setdefault(line["client_id"], []).append(line)
    mixed = [r for r in chain.from_iterable(zip_longest(*by_client.values())) if r]
    return mixed[:n]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--send", action="store_true", help="really call Mubit (costs credit)")
    parser.add_argument("--n", type=int, default=30, help="number of rows to replay (default 30)")
    args = parser.parse_args()

    rows = history_rows(args.n)
    if not args.send:
        print(f"Dry run: would send {len(rows)} rows. Add --send to call Mubit.")
        for line in rows:
            print(f"  {line['id']}  {line['description']}")
        return

    load_dotenv(ledger.HERE / ".env")
    llm = ledger.make_llm()
    session_id = f"ledger-seed-{int(time.time())}"
    stats = ledger.Stats()
    for line in rows:
        try:
            result = ledger.suggest(llm, line, session_id)
        except Exception as exc:
            print(f"{line['id']}  error: {str(exc)[:120]}")
            continue
        final = {"account": line["account"], "tax": line["tax"]}
        entry = ledger.make_correction(line, result, final)
        ledger.log_correction(entry)
        ledger.send_correction(entry["trace_id"], final)
        stats.add_call(result)
        stats.add_outcome(entry["outcome"])
        model = "small" if result["small"] else "big"
        print(
            f"{line['id']}  {line['description'][:34]:34}  {result['account']}/{result['tax']}"
            f"  want {final['account']}/{final['tax']}  {entry['outcome']:8}  {model} {result['latency_ms']}ms"
            f"  {result['trace_id']}"
        )
    print(stats.to_dict())


if __name__ == "__main__":
    main()
