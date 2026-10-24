"""Pure-logic tests. The OpenAI client is always a fake; these tests make no network calls."""

import pytest

import tariff
from eval import score
from fakes import GOOD_REPLY, SMALL_HEADERS, FakeClient


def test_system_prompt_is_fixed_and_item_goes_in_user_message():
    a = tariff.build_messages("T-shirt with horses on it")
    b = tariff.build_messages("  Cast iron doorstop  ")
    assert a[0] == b[0] == {"role": "system", "content": tariff.SYSTEM_PROMPT}
    assert "horses" not in tariff.SYSTEM_PROMPT
    assert a[1]["role"] == "user" and "T-shirt with horses on it" in a[1]["content"]
    assert b[1]["content"].endswith("Cast iron doorstop")


def test_parse_answer_normalizes_code_and_sure():
    assert tariff.parse_answer(GOOD_REPLY) == {
        "hs6": "610910",
        "reason": "Knitted cotton T-shirt, heading 6109.",
        "sure": "high",
    }
    assert tariff.parse_answer('{"hs6": "6109100012", "reason": "x", "sure": "maybe"}')["sure"] == "low"
    assert tariff.parse_answer('{"hs6": "6109100012", "reason": "x"}')["hs6"] == "610910"


@pytest.mark.parametrize("bad", ["not json", "[]", '{"hs6": "6109"}', '{"reason": "no code"}', None])
def test_parse_answer_rejects_bad_replies(bad):
    with pytest.raises(ValueError):
        tariff.parse_answer(bad)


def test_parse_headers_small_and_big_model():
    small = tariff.parse_headers(SMALL_HEADERS)
    assert small == {"served_by": "adapter-vllm-7", "small_model": True, "trace_id": "trc_abc123"}
    big = tariff.parse_headers({"x-middleware-served-by": "openai", "x-middleware-request-id": "mreq_1"})
    assert big == {"served_by": "openai", "small_model": False, "trace_id": "mreq_1"}
    assert tariff.parse_headers({}) == {"served_by": "", "small_model": False, "trace_id": ""}


def test_classify_sends_one_clean_task_and_logs_the_call():
    client = FakeClient(GOOD_REPLY, SMALL_HEADERS)
    call = tariff.classify(client, "T-shirt with horses on it")

    sent = client.calls[0]
    assert sent["model"] == tariff.MODEL
    assert sent["messages"] == tariff.build_messages("T-shirt with horses on it")
    assert sent["response_format"] == {"type": "json_object"}
    assert "store" not in sent
    assert "metadata" not in sent
    assert "tools" not in sent

    assert call["trace_id"] == "trc_abc123"
    assert call["answer"]["hs6"] == "610910"
    assert call["small_model"] is True
    assert isinstance(call["latency_ms"], int)
    assert tariff.read_jsonl(tariff.CALLS_LOG) == [call]
    assert tariff.find_call("trc_abc123") == call


def test_accept_and_fix_write_one_line_each_and_update_counters():
    client = FakeClient(GOOD_REPLY, SMALL_HEADERS)
    call = tariff.classify(client, "T-shirt with horses on it")

    accepted = tariff.record_feedback(call, "610910")
    fixed = tariff.record_feedback(call, "6109.90")

    lines = tariff.read_jsonl(tariff.CORRECTIONS_LOG)
    assert [line["verdict"] for line in lines] == ["accepted", "fixed"]
    assert lines[1]["trace_id"] == "trc_abc123"
    assert lines[1]["input"] == "T-shirt with horses on it"
    assert lines[1]["model_answer"]["hs6"] == "610910"
    assert lines[1]["final_answer"]["hs6"] == "610990"
    assert "time" in lines[1]
    assert accepted["sent_to_mubit"] is False and fixed["sent_to_mubit"] is False

    assert tariff.stats() == {"calls": 1, "small_pct": 100, "avg_latency_ms": call["latency_ms"], "accepts": 1, "fixes": 1}
    assert tariff.history()[0]["verdict"] == "fixed"
    assert tariff.history()[0]["final_hs6"] == "610990"


@pytest.mark.parametrize("bad", ["6109", "61091000", "abcdef", ""])
def test_fix_must_be_six_digits(bad):
    call = tariff.classify(FakeClient(GOOD_REPLY, SMALL_HEADERS), "T-shirt")
    with pytest.raises(ValueError):
        tariff.record_feedback(call, bad)
    assert tariff.read_jsonl(tariff.CORRECTIONS_LOG) == []


def test_eval_score_counts_exact_and_heading_matches():
    assert score([("610910", "610910"), ("610990", "610910"), ("420222", "610910"), (None, "610910")]) == (1, 2)
