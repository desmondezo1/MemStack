"""Score the app on held-out rows with known codes.

Prints exact 6-digit and first-4-digit match, the small-model share and the average latency.
Does nothing unless run with --send:
    python eval.py              # dry run
    python eval.py --n 20 --send
"""

import argparse

import openai

import tariff

HELDOUT_FILE = tariff.DATA_DIR / "heldout.jsonl"


def score(pairs):
    """pairs: list of (predicted hs6 or None, expected hs6). Returns exact and 4-digit match counts."""
    exact = sum(1 for got, want in pairs if got == want)
    heading = sum(1 for got, want in pairs if got and got[:4] == want[:4])
    return exact, heading


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--send", action="store_true", help="really call Mubit (each row is one paid call)")
    parser.add_argument("--n", type=int, default=20, help="how many held-out rows to score (default 20)")
    args = parser.parse_args()

    rows = tariff.read_jsonl(HELDOUT_FILE)[: max(args.n, 0)]
    if not args.send:
        print(f"Dry run: would score {len(rows)} held-out rows. Add --send to call Mubit.")
        return

    client = tariff.make_client(max_retries=0)  # no silent retries: one row is one call
    pairs, small, latencies = [], 0, []
    for i, row in enumerate(rows, 1):
        try:
            call = tariff.classify(client, row["description"], source="eval")
        except (ValueError, openai.APIError) as exc:
            print(f"{i:3}/{len(rows)}  bad reply: {exc}")
            pairs.append((None, row["hs6"]))
            continue
        got = call["answer"]["hs6"]
        pairs.append((got, row["hs6"]))
        small += call["small_model"]
        latencies.append(call["latency_ms"])
        print(f"{i:3}/{len(rows)}  got {got} want {row['hs6']}  {call['latency_ms']} ms")

    n = len(pairs)
    exact, heading = score(pairs)
    answered = len(latencies)
    print()
    print(f"Rows scored:       {n}")
    print(f"Exact 6-digit:     {exact}/{n} ({100 * exact / n:.0f}%)" if n else "Exact 6-digit:     -")
    print(f"First 4 digits:    {heading}/{n} ({100 * heading / n:.0f}%)" if n else "First 4 digits:    -")
    print(f"Small model share: {small}/{answered}" + (f" ({100 * small / answered:.0f}%)" if answered else ""))
    print(f"Average latency:   {sum(latencies) / answered:.0f} ms" if answered else "Average latency:   -")


if __name__ == "__main__":
    main()
