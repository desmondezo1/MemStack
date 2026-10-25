import json

from fastapi.testclient import TestClient

import corrections
import main
import triage

ITEM = {"text": "I need a flu jab", "route": "nurse", "reply": "Book the nurse.", "sure": "high", "served_by": "small", "trace_id": "trc_abc"}


def test_accept_and_fix_write_one_json_line_each(tmp_path):
    path = tmp_path / "log.jsonl"
    corrections.record_review(ITEM, "accepted", path=path)
    corrections.record_review(ITEM, "fixed", new_route="pharmacist", path=path)
    lines = [json.loads(line) for line in path.read_text().splitlines()]
    assert [line["outcome"] for line in lines] == ["accepted", "fixed"]
    assert lines[0]["final_answer"]["route"] == "nurse"
    assert lines[1]["final_answer"] == {"route": "pharmacist", "reply": triage.ROUTE_REPLIES["pharmacist"], "sure": "high"}
    for line in lines:
        assert line["trace_id"] == "trc_abc"
        assert line["input"] == "I need a flu jab"
        assert line["model_answer"]["route"] == "nurse"
        assert line["time"]


def test_send_correction_stays_local():
    assert corrections.send_correction("trc_abc", {"route": "nurse"})["sent_to_mubit"] is False


def test_api_triage_review_and_counters(monkeypatch, fake_client):
    monkeypatch.setattr(triage, "get_client", lambda: fake_client)
    api = TestClient(main.app)
    item = api.post("/api/triage", json={"text": "I need a flu jab", "source": "text"}).json()
    assert item["served_by"] == "small" and item["route"] == "nurse"
    rule = api.post("/api/triage", json={"text": "chest pain", "source": "voice"}).json()
    assert rule["served_by"] == "rule"

    fixed = api.post("/api/review", json={"id": item["id"], "action": "fix", "route": "pharmacist"}).json()
    assert fixed["item"]["status"] == "changed"
    accepted = api.post("/api/review", json={"id": rule["id"], "action": "accept"}).json()
    assert accepted["item"]["status"] == "ok"
    assert api.post("/api/review", json={"id": item["id"], "action": "fix", "route": "dentist"}).status_code == 400

    stats = api.get("/api/stats").json()
    assert stats["accepts"] == 1 and stats["fixes"] == 1
    assert stats["rule_hits"] >= 1 and stats["calls"] >= 1
    assert len(corrections.read_corrections()) == 2
    assert len(fake_client.calls) == 1
