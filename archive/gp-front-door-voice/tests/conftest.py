import json
from types import SimpleNamespace

import httpx
import pytest

import corrections
import triage


class FakeRaw:
    def __init__(self, content, headers):
        self.headers = httpx.Headers(headers)
        self._content = content

    def parse(self):
        message = SimpleNamespace(content=self._content)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class FakeClient:
    """Stands in for openai.OpenAI: records each create() call, never touches the network."""

    def __init__(self, content=None, served_by="vllm-adapter", trace="trc_0123456789abcdef"):
        self.content = content or json.dumps({"route": "nurse", "reply": "We will book you in with the nurse.", "sure": "high"})
        self.headers = {"x-middleware-served-by": served_by, "x-middleware-trace": trace}
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(with_raw_response=SimpleNamespace(create=self.create)))

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return FakeRaw(self.content, self.headers)


@pytest.fixture(autouse=True)
def no_network(monkeypatch, tmp_path):
    def refuse():
        raise AssertionError("tests must not build a real Mubit client")

    monkeypatch.setattr(triage, "get_client", refuse)
    monkeypatch.setattr(corrections, "CORRECTIONS_PATH", tmp_path / "corrections.jsonl")


@pytest.fixture
def fake_client():
    return FakeClient()
