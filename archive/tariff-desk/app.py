"""Tariff Desk web app: serves the page and the classify, feedback, stats and history API."""

from functools import lru_cache

import openai
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

import tariff

app = FastAPI(title="Tariff Desk")


class ClassifyIn(BaseModel):
    description: str


class FeedbackIn(BaseModel):
    trace_id: str
    hs6: str


@lru_cache(maxsize=1)
def get_client():
    return tariff.make_client()


@app.get("/")
def index():
    return FileResponse(tariff.APP_DIR / "static" / "index.html")


@app.post("/api/classify")
def classify(body: ClassifyIn):
    description = body.description.strip()
    if not description:
        raise HTTPException(400, "Type a product description first.")
    if len(description) > 1000:
        raise HTTPException(400, "Keep the description under 1000 characters.")
    try:
        client = get_client()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    try:
        call = tariff.classify(client, description)
    except ValueError as exc:
        raise HTTPException(502, f"The model reply could not be read: {exc}") from exc
    except openai.APIError as exc:
        raise HTTPException(502, f"Mubit call failed: {str(exc)[:300]}") from exc
    return {"call": call, "stats": tariff.stats()}


@app.post("/api/feedback")
def feedback(body: FeedbackIn):
    call = tariff.find_call(body.trace_id)
    if call is None:
        raise HTTPException(404, "No call with that trace id.")
    try:
        entry = tariff.record_feedback(call, body.hs6)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"feedback": entry, "stats": tariff.stats()}


@app.get("/api/stats")
def stats():
    return tariff.stats()


@app.get("/api/history")
def history():
    return tariff.history()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8101)
