"""Ledger Tab web app: run with `uvicorn app:app --port 8102` from archive/ledger-tab."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

import ledger

load_dotenv(ledger.HERE / ".env")

app = FastAPI(title="Ledger Tab")
SESSION_ID = f"ledger-tab-{int(time.time())}"
LINES = {line["id"]: line for line in ledger.load_lines()}
SUGGESTIONS = {}  # line id -> latest suggestion; also stops a page reload from paying twice
DECIDED = {}  # line id -> {"outcome", "account", "tax"} once the bookkeeper accepts or fixes it
STATS = ledger.Stats()
LOCK = threading.Lock()
POOL = ThreadPoolExecutor(max_workers=5)
MAX_BATCH = 10
_llm = None


def get_llm():
    global _llm
    if _llm is None:
        _llm = ledger.make_llm()
    return _llm


class SuggestRequest(BaseModel):
    line_ids: list[str]
    fresh: bool = False


class FeedbackRequest(BaseModel):
    line_id: str
    account: str
    tax: str


def public_line(line):
    return {k: line[k] for k in ("id", "client_id", "date", "description", "amount")}


def suggest_one(line_id):
    with LOCK:
        cached = SUGGESTIONS.get(line_id)
    if cached:
        return {**cached, "cached": True}
    try:
        result = ledger.suggest(get_llm(), LINES[line_id], SESSION_ID)
    except Exception as exc:  # shown on the row; the bookkeeper can still code it by hand
        return {"line_id": line_id, "error": str(exc)[:200]}
    result["line_id"] = line_id
    with LOCK:
        SUGGESTIONS[line_id] = result
        STATS.add_call(result)
    return result


@app.get("/")
def index():
    return FileResponse(ledger.HERE / "static" / "index.html")


@app.get("/api/meta")
def meta():
    return {
        "clients": [{"id": c["id"], "name": c["name"]} for c in ledger.CLIENTS.values()],
        "accounts": ledger.CHART["accounts"],
        "tax_codes": ledger.CHART["tax_codes"],
        "model": ledger.MODEL,
    }


@app.get("/api/lines")
def lines(client_id: str):
    if client_id not in ledger.CLIENTS:
        raise HTTPException(404, "unknown client")
    rows = []
    with LOCK:
        for line in LINES.values():
            if line["client_id"] == client_id and line["set"] == "statement":
                rows.append({**public_line(line), "suggestion": SUGGESTIONS.get(line["id"]), "decided": DECIDED.get(line["id"])})
    return {"lines": rows}


@app.post("/api/suggest")
def suggest(req: SuggestRequest):
    ids = [i for i in req.line_ids if i in LINES][:MAX_BATCH]
    if req.fresh:
        with LOCK:
            for i in ids:
                SUGGESTIONS.pop(i, None)
    results = list(POOL.map(suggest_one, ids))
    with LOCK:
        return {"suggestions": results, "stats": STATS.to_dict()}


@app.post("/api/feedback")
def feedback(req: FeedbackRequest):
    line = LINES.get(req.line_id)
    with LOCK:
        suggestion = SUGGESTIONS.get(req.line_id)
    if not line or not suggestion:
        raise HTTPException(409, "no suggestion for this line yet")
    if req.account not in ledger.ACCOUNTS or req.tax not in ledger.TAX_CODES:
        raise HTTPException(422, "unknown account or tax code")
    final = {"account": req.account, "tax": req.tax}
    entry = ledger.make_correction(line, suggestion, final)
    ledger.log_correction(entry)
    ledger.send_correction(entry["trace_id"], final)

    refresh = []
    with LOCK:
        STATS.add_outcome(entry["outcome"])
        DECIDED[line["id"]] = {"outcome": entry["outcome"], **final}
        if entry["outcome"] == "fixed":
            # Drop prefetched suggestions for the same merchant so they are asked again with this fix.
            key = ledger.merchant_key(line["description"])
            for other_id, other in list(SUGGESTIONS.items()):
                other_line = LINES[other_id]
                if (
                    other_id not in DECIDED
                    and other_line["client_id"] == line["client_id"]
                    and ledger.merchant_key(other_line["description"]) == key
                    and (other.get("account"), other.get("tax")) != (req.account, req.tax)
                ):
                    SUGGESTIONS.pop(other_id)
                    refresh.append(other_id)
        stats = STATS.to_dict()
    return {"outcome": entry["outcome"], "refresh": refresh, "stats": stats}


@app.get("/api/stats")
def stats():
    with LOCK:
        return STATS.to_dict()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8102)
