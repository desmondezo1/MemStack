"""API flow test with a fake client: classify, then fix, through the FastAPI routes. No network calls."""

from fastapi.testclient import TestClient

import app as web
import tariff
from fakes import FakeClient


def test_classify_then_fix(monkeypatch):
    monkeypatch.setattr(web, "get_client", lambda: FakeClient())
    http = TestClient(web.app)

    assert http.get("/").status_code == 200
    res = http.post("/api/classify", json={"description": "T-shirt with horses on it"})
    assert res.status_code == 200
    call = res.json()["call"]
    assert call["answer"]["hs6"] == "610910"

    assert http.post("/api/feedback", json={"trace_id": call["trace_id"], "hs6": "12"}).status_code == 400
    assert http.post("/api/feedback", json={"trace_id": "nope", "hs6": "610990"}).status_code == 404
    res = http.post("/api/feedback", json={"trace_id": call["trace_id"], "hs6": "610990"})
    assert res.status_code == 200
    assert res.json()["stats"]["fixes"] == 1

    assert http.get("/api/history").json()[0]["verdict"] == "fixed"
    assert len(tariff.read_jsonl(tariff.CORRECTIONS_LOG)) == 1


def test_empty_description_is_rejected(monkeypatch):
    monkeypatch.setattr(web, "get_client", lambda: FakeClient())
    assert TestClient(web.app).post("/api/classify", json={"description": "  "}).status_code == 400
