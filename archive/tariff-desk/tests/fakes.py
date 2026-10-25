import json
from types import SimpleNamespace

SMALL_HEADERS = {"X-Middleware-Served-By": "adapter-vllm-7", "X-Middleware-Trace": "trc_abc123"}
GOOD_REPLY = json.dumps({"hs6": "6109.10", "reason": "Knitted cotton T-shirt, heading 6109.", "sure": "High"})


class FakeClient:
    """Stands in for openai.OpenAI: records each create() call and returns a canned raw response."""

    def __init__(self, content=GOOD_REPLY, headers=SMALL_HEADERS):
        self.calls = []
        raw = SimpleNamespace(
            headers=headers,
            parse=lambda: SimpleNamespace(
                model="gpt-6-luna",
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
            ),
        )

        def create(**kwargs):
            self.calls.append(kwargs)
            return raw

        self.chat = SimpleNamespace(completions=SimpleNamespace(with_raw_response=SimpleNamespace(create=create)))
