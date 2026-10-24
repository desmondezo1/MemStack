"""Replay seed rows through the app's own call path so Mubit gets examples of the task.

Does nothing unless run with --send:
    python seed.py              # dry run, shows what would be sent
    python seed.py --send --n 30
"""

import argparse

import openai

import tariff

SEED_FILE = tariff.DATA_DIR / "seed.jsonl"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--send", action="store_true", help="really call Mubit (each row is one paid call)")
    parser.add_argument("--n", type=int, default=30, help="how many seed rows to send (default 30)")
    args = parser.parse_args()

    rows = tariff.read_jsonl(SEED_FILE)[: max(args.n, 0)]
    if not args.send:
        print(f"Dry run: would send {len(rows)} of the seed rows. Add --send to call Mubit.")
        for row in rows[:5]:
            print(f"  {row['hs6']}  {row['description'][:80]}")
        return

    client = tariff.make_client(max_retries=0)  # no silent retries: one row is one call
    matches = 0
    for i, row in enumerate(rows, 1):
        try:
            call = tariff.classify(client, row["description"], source="seed")
        except (ValueError, openai.APIError) as exc:
            print(f"{i:3}/{len(rows)}  bad reply: {exc}")
            continue
        hit = call["answer"]["hs6"] == row["hs6"]
        matches += hit
        model = "small" if call["small_model"] else "big"
        print(f"{i:3}/{len(rows)}  {model:5} {call['latency_ms']:5} ms  "
              f"got {call['answer']['hs6']} want {row['hs6']} {'ok' if hit else '--'}")
    print(f"Sent {len(rows)} rows, {matches} exact 6-digit matches.")


if __name__ == "__main__":
    main()
