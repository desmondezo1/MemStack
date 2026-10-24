"""GP Front Door Voice: FastAPI app. Run with `uvicorn main:app --port 8103`."""

import itertools
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import corrections
import triage

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="GP Front Door Voice")

# In-memory inbox: it resets when the server restarts. The corrections log is the durable record.
_inbox = []
_inbox_lock = threading.Lock()
_ids = itertools.count(1)


class TriageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    source: str = "text"
    session_id: str | None = None


class ReviewRequest(BaseModel):
    id: int
    action: str  # "accept" or "fix"
    route: str | None = None


def handle_request(text, source="text", session_id=None, client=None):
    """The one call path: the API and seed.py both go through here."""
    answer = triage.triage(text, client=client, session_id=session_id)
    item = {
        "id": next(_ids),
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "text": text.strip(),
        "source": source,
        **answer,
        "trace_short": triage.short_trace(answer["trace_id"]),
        "status": "new",
        "final_route": "",
    }
    with _inbox_lock:
        _inbox.append(item)
    return item


def stats():
    with _inbox_lock:
        items = list(_inbox)
    model_calls = [item for item in items if item["served_by"] in ("small", "big")]
    small = sum(1 for item in model_calls if item["served_by"] == "small")
    reviews = corrections.read_corrections()
    return {
        "calls": len(model_calls),
        "rule_hits": sum(1 for item in items if item["served_by"] == "rule"),
        "small_pct": round(100 * small / len(model_calls)) if model_calls else 0,
        "avg_latency_ms": round(sum(item["latency_ms"] for item in model_calls) / len(model_calls)) if model_calls else 0,
        "accepts": sum(1 for record in reviews if record["outcome"] == "accepted"),
        "fixes": sum(1 for record in reviews if record["outcome"] == "fixed"),
        "needs_person": sum(1 for item in items if item["needs_person"] and item["status"] == "new"),
    }


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
def config():
    return {"routes": triage.ROUTES, "model": triage.MODEL}


@app.post("/api/triage")
def triage_endpoint(request: TriageRequest):
    try:
        return handle_request(request.text, source=request.source, session_id=request.session_id)
    except RuntimeError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except Exception as err:  # Mubit or network error: keep the page alive.
        raise HTTPException(status_code=502, detail=f"Mubit call failed: {type(err).__name__}") from err


@app.get("/api/inbox")
def inbox():
    with _inbox_lock:
        items = list(reversed(_inbox))
    return {"items": items, "stats": stats()}


@app.post("/api/review")
def review(request: ReviewRequest):
    if request.action not in ("accept", "fix"):
        raise HTTPException(status_code=400, detail="action must be accept or fix")
    if request.action == "fix" and request.route not in triage.ROUTES:
        raise HTTPException(status_code=400, detail="fix needs one of the routes")
    with _inbox_lock:
        item = next((entry for entry in _inbox if entry["id"] == request.id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="no such request")
    if request.action == "fix" and request.route == item["route"]:
        outcome, new_route = "accepted", None
    else:
        outcome, new_route = ("accepted", None) if request.action == "accept" else ("fixed", request.route)
    record = corrections.record_review(item, outcome, new_route)
    item["status"] = "ok" if outcome == "accepted" else "changed"
    item["final_route"] = record["final_answer"]["route"]
    return {"item": item, "stats": stats()}


@app.get("/api/stats")
def stats_endpoint():
    return stats()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8103)
