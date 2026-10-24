"""Pure-logic tests. The OpenAI client is always a fake, so these make no network calls."""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ledger  # noqa: E402

LINE = {"id": "c1-900", "client_id": "c1", "date": "2026-09-04", "description": "TESCO STORES 2041", "amount": "-23.10"}


class FakeLLM:
    """Stands in for OpenAI(): records the call and returns a canned raw response."""

    def __init__(self, content, headers):
        self.calls = []
        raw = SimpleNamespace(
            headers=headers,
            parse=lambda: SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))]),
        )
        create = lambda **kwargs: (self.calls.append(kwargs), raw)[1]  # noqa: E731
        self.chat = SimpleNamespace(completions=SimpleNamespace(with_raw_response=SimpleNamespace(create=create)))


def test_system_prompt_is_fixed_and_holds_no_client_data():
    assert '"account"' in ledger.SYSTEM_PROMPT and "5000 Purchases" in ledger.SYSTEM_PROMPT
    for client in ledger.CLIENTS.values():
        assert client["name"] not in ledger.SYSTEM_PROMPT
        assert client["profile"] not in ledger.SYSTEM_PROMPT


def test_user_message_carries_client_line_and_last_decision():
    client = ledger.CLIENTS["c1"]
    decision = {"description": "TESCO STORES 3317", "account": "5000", "tax": "Z0"}
    msg = ledger.build_user_message(client, LINE, decision)
    assert "Client: c1 (Oven Lane Bakery)" in msg
    assert client["profile"] in msg
    assert "TESCO STORES 3317 -> 5000 / Z0" in msg
    assert msg.endswith("Bank line: 2026-09-04 | TESCO STORES 2041 | -23.10")
    assert "Last decision" not in ledger.build_user_message(client, LINE)


@pytest.mark.parametrize(
    "text, want",
    [
        ('{"account": "5000", "tax": "Z0", "sure": "high"}', ("5000", "Z0", "high", True)),
        ('{"account": "5000 Purchases", "tax": "z0", "sure": "MEDIUM"}', ("5000", "Z0", "medium", True)),
        ('{"account": "9999", "tax": "Z0", "sure": "maybe"}', (None, "Z0", "low", False)),
        ("not json", (None, None, "low", False)),
        ("[1, 2]", (None, None, "low", False)),
    ],
)
def test_parse_answer(text, want):
    got = ledger.parse_answer(text)
    assert (got["account"], got["tax"], got["sure"], got["valid"]) == want


def test_parse_headers_small_and_big_model():
    small = ledger.parse_headers({"x-middleware-served-by": "mubit-vllm-adapter", "x-middleware-trace": "trc_abc"})
    assert small == {"served_by": "mubit-vllm-adapter", "small": True, "trace_id": "trc_abc"}
    big = ledger.parse_headers({"x-middleware-served-by": "openai"})
    assert big["small"] is False and big["trace_id"] is None
    plain = ledger.parse_headers({"x-middleware-request-id": "mreq_1", "x-middleware-trace": ""})
    assert plain == {"served_by": "", "small": False, "trace_id": "mreq_1"}
    assert ledger.parse_headers({})["small"] is False


def test_ask_mubit_sends_one_clean_task(monkeypatch):
    llm = FakeLLM('{"account": "5000", "tax": "Z0", "sure": "high"}',
                  {"x-middleware-served-by": "vllm", "x-middleware-trace": "trc_1"})
    monkeypatch.setattr(ledger, "STORE", False)
    result = ledger.ask_mubit(llm, "user text", "sess-1")
    monkeypatch.setattr(ledger, "STORE", True)
    ledger.ask_mubit(llm, "user text", "sess-1")
    call, stored = llm.calls
    assert call["model"] == ledger.MODEL
    assert call["messages"][0] == {"role": "system", "content": ledger.SYSTEM_PROMPT}
    assert call["messages"][1] == {"role": "user", "content": "user text"}
    assert call["response_format"] == {"type": "json_object"}
    assert "tools" not in call
    # The starter credit rejects store, and metadata needs store, so both are opt-in.
    assert "store" not in call and "metadata" not in call
    assert stored["store"] is True and stored["metadata"] == {"session_id": "sess-1"}
    assert result["account"] == "5000" and result["small"] is True and result["trace_id"] == "trc_1"
    assert isinstance(result["latency_ms"], int)


def test_correction_log_and_last_decision(tmp_path):
    path = tmp_path / "corrections.jsonl"
    suggestion = {"account": "5000", "tax": "Z0", "sure": "high", "trace_id": "trc_1", "user_message": "u"}
    accepted = ledger.make_correction(LINE, suggestion, {"account": "5000", "tax": "Z0"})
    assert accepted["outcome"] == "accepted"
    ledger.log_correction(accepted, path)

    fixed = ledger.make_correction({**LINE, "id": "c1-901"}, suggestion, {"account": "8200", "tax": "Z0"})
    assert fixed["outcome"] == "fixed"
    ledger.log_correction(fixed, path)

    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert [r["outcome"] for r in rows] == ["accepted", "fixed"]
    assert rows[0]["trace_id"] == "trc_1" and rows[0]["input"]["client_id"] == "c1"
    assert set(rows[0]) >= {"time", "trace_id", "input", "model_answer", "final_answer", "outcome"}

    # Latest decision wins, matched by merchant and client only.
    assert ledger.last_decision("c1", "TESCO STORES 7777", path)["account"] == "8200"
    assert ledger.last_decision("c2", "TESCO STORES 7777", path) is None
    assert ledger.last_decision("c1", "SHELL LEEDS", path) is None
    assert ledger.send_correction("trc_1", {"account": "8200", "tax": "Z0"}) is False


def test_app_fix_logs_and_refreshes_same_merchant(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    import app as app_module

    monkeypatch.setattr(ledger, "CORRECTIONS_PATH", tmp_path / "corrections.jsonl")
    llm = FakeLLM('{"account": "5000", "tax": "Z0", "sure": "high"}', {"x-middleware-served-by": "openai"})
    monkeypatch.setattr(app_module, "get_llm", lambda: llm)
    monkeypatch.setattr(app_module, "SUGGESTIONS", {})
    monkeypatch.setattr(app_module, "DECIDED", {})
    monkeypatch.setattr(app_module, "STATS", ledger.Stats())
    client = TestClient(app_module.app)

    lines = client.get("/api/lines", params={"client_id": "c2"}).json()["lines"]
    by_key = {}
    for line in lines:
        by_key.setdefault(ledger.merchant_key(line["description"]), []).append(line["id"])
    first, second = next(ids for ids in by_key.values() if len(ids) >= 2)[:2]

    res = client.post("/api/suggest", json={"line_ids": [first, second]}).json()
    assert [s["account"] for s in res["suggestions"]] == ["5000", "5000"]
    assert res["stats"] == {**res["stats"], "calls": 2, "small_pct": 0}

    # Asking again is served from the cache, so it costs nothing.
    client.post("/api/suggest", json={"line_ids": [first, second]})
    assert len(llm.calls) == 2

    fix = client.post("/api/feedback", json={"line_id": first, "account": "8200", "tax": "Z0"}).json()
    assert fix["outcome"] == "fixed" and fix["stats"]["fixes"] == 1
    assert fix["refresh"] == [second]
    entry = json.loads((tmp_path / "corrections.jsonl").read_text().splitlines()[0])
    assert entry["final_answer"] == {"account": "8200", "tax": "Z0"} and entry["outcome"] == "fixed"

    # The refreshed line is asked again, now with the fix in its user message.
    client.post("/api/suggest", json={"line_ids": [second]})
    assert "-> 8200 / Z0" in llm.calls[-1]["messages"][1]["content"]
