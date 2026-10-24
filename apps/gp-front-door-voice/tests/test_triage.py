import json

import httpx
import pytest

import triage


def test_system_prompt_is_fixed_and_request_goes_in_user_message():
    messages = triage.build_messages("I need a sick note for work")
    assert messages[0] == {"role": "system", "content": triage.SYSTEM_PROMPT}
    assert "sick note for work" not in messages[0]["content"]
    assert messages[1]["role"] == "user"
    assert messages[1]["content"].endswith("I need a sick note for work")
    for route in triage.ROUTES:
        assert route in triage.SYSTEM_PROMPT


def test_parse_answer_accepts_valid_json_and_code_fences():
    answer = triage.parse_answer('```json\n{"route": "Admin", "reply": "We will sort it.", "sure": "HIGH"}\n```')
    assert answer == {"route": "admin", "reply": "We will sort it.", "sure": "high"}


def test_parse_answer_turns_unknown_sure_into_low():
    answer = triage.parse_answer(json.dumps({"route": "nurse", "reply": "Book a nurse.", "sure": "maybe"}))
    assert answer["sure"] == "low"


@pytest.mark.parametrize("content", ["not json", "[]", '{"route": "dentist", "reply": "x", "sure": "high"}', '{"route": "nurse", "reply": ""}'])
def test_parse_answer_rejects_bad_shapes(content):
    with pytest.raises(ValueError):
        triage.parse_answer(content)


@pytest.mark.parametrize(
    "text, rule",
    [
        ("I've got crushing chest pain", "chest pain"),
        ("my dad can't breathe", "breathing"),
        ("her face is drooping and speech is slurred", "stroke signs"),
        ("the cut won't stop bleeding", "heavy bleeding"),
        ("I keep thinking about ending my life", "suicidal thoughts"),
        ("I can’t breathe", "breathing"),
    ],
)
def test_red_flags_match(text, rule):
    assert triage.check_red_flags(text)[0] == rule


@pytest.mark.parametrize(
    "text",
    ["I need a sick note", "I can't breathe through my nose with this cold", "I'd like my coil fitting booked", "my dad had a stroke last year and needs a review"],
)
def test_red_flags_ignore_routine_requests(text):
    assert triage.check_red_flags(text) is None


def test_served_by_header_parsing():
    assert triage.parse_served_by("vllm-adapter-v2") == "small"
    assert triage.parse_served_by("VLLM") == "small"
    assert triage.parse_served_by("openai") == "big"
    assert triage.parse_served_by(None) == "big"
    assert triage.short_trace("trc_0123456789abcdef") == "trc_…abcdef"
    assert triage.short_trace("") == ""


def test_trace_id_falls_back_to_request_id():
    assert triage.parse_trace_id(httpx.Headers({"x-middleware-trace": "trc_1", "x-middleware-request-id": "mreq_2"})) == "trc_1"
    assert triage.parse_trace_id(httpx.Headers({"x-middleware-request-id": "mreq_2"})) == "mreq_2"
    assert triage.parse_trace_id(httpx.Headers({})) == ""


def test_triage_calls_mubit_as_one_clean_task(fake_client):
    result = triage.triage("I need a flu jab", client=fake_client, session_id="s1")
    assert result["route"] == "nurse"
    assert result["served_by"] == "small"
    assert result["trace_id"] == "trc_0123456789abcdef"
    assert result["needs_person"] is False
    call = fake_client.calls[0]
    assert call["model"] == triage.MODEL
    assert "store" not in call and "metadata" not in call  # Mubit's starter credit rejects store
    assert call["response_format"] == {"type": "json_object"}
    assert call["messages"][0]["content"] == triage.SYSTEM_PROMPT
    assert "tools" not in call


def test_red_flag_skips_the_model(fake_client):
    result = triage.triage("I have chest pain and feel sick", client=fake_client)
    assert result["served_by"] == "rule"
    assert result["route"] == "urgent_111"
    assert "999" in result["reply"]
    assert fake_client.calls == []


def test_low_sure_or_bad_output_goes_to_a_person(fake_client):
    fake_client.content = json.dumps({"route": "routine_gp", "reply": "We will call you.", "sure": "low"})
    assert triage.triage("it's about my mum", client=fake_client)["needs_person"] is True
    fake_client.content = "sorry, I can't help"
    result = triage.triage("hello?", client=fake_client)
    assert result["needs_person"] is True
    assert result["route"] == ""
    assert result["error"]


def test_store_and_session_metadata_when_enabled(fake_client):
    triage.call_mubit("I need a flu jab", client=fake_client, session_id="s1", store=True)
    call = fake_client.calls[0]
    assert call["store"] is True
    assert call["metadata"] == {"session_id": "s1"}
