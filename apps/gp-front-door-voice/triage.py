"""Triage logic: red-flag rules first, then one Mubit call that picks a route."""

import json
import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
load_dotenv(APP_DIR / ".env")

MUBIT_BASE_URL = "https://api.mubit.ai/openai/v1"
MODEL = "gpt-6-luna"
# Mubit's starter credit rejects store=true (HTTP 400 starter_credit_option). Set MUBIT_STORE=1
# once your own OpenAI key is added under Provider keys in the Mubit console.
STORE = os.environ.get("MUBIT_STORE", "0") == "1"

ROUTES = {
    "same_day_gp": "Same-day GP",
    "routine_gp": "Routine GP",
    "nurse": "Practice nurse",
    "pharmacist": "Pharmacist",
    "admin": "Admin team",
    "self_care": "Self-care",
    "urgent_111": "Urgent: 111 / 999",
}
SURE_LEVELS = ("high", "medium", "low")

# One fixed system prompt = one Mubit task. Never put the request, the patient,
# or dates in here: anything that changes goes in the user message.
SYSTEM_PROMPT = """You are the front-door assistant for a UK GP practice. A patient has sent a request in their own words, by voice or text. Pick the one route that fits best and write a short reply to say back to them.

Routes:
- same_day_gp: a new or worsening problem that needs a GP today, but is not an emergency.
- routine_gp: a GP appointment in the next 1 to 2 weeks: ongoing problems, reviews, discussing results, low mood without risk.
- nurse: blood tests, smears, vaccines and travel jabs, dressings, blood pressure checks, injections, asthma and diabetes reviews.
- pharmacist: questions about medicines, repeat medicine problems, side effects, and minor illnesses a pharmacist can treat.
- admin: sick notes and fit notes, letters, forms, registration, referrals, and asking whether results are back.
- self_care: minor problems that usually get better at home with rest and over-the-counter help.
- urgent_111: urgent problems that cannot wait for the practice: tell them to call 111, or 999 if life is at risk.

Rules:
- If in doubt between two routes, pick the safer, more urgent one.
- Do not diagnose. Do not give medicine doses.
- The reply is one or two short, kind sentences in plain English that tell the patient what happens next.
- sure is "high" when the route is clear, "medium" when it is likely, and "low" when the request is unclear or you need more detail. A person checks every "low" request.

Answer with JSON only, in exactly this shape:
{"route": "<one of: same_day_gp, routine_gp, nurse, pharmacist, admin, self_care, urgent_111>", "reply": "<one or two short sentences>", "sure": "<high|medium|low>"}"""

# Fixed replies used when a navigator changes the route.
ROUTE_REPLIES = {
    "same_day_gp": "Thank you. A GP will call you back today.",
    "routine_gp": "Thank you. We will book you a GP appointment in the next two weeks.",
    "nurse": "Thank you. We will book you in with the practice nurse.",
    "pharmacist": "Thank you. Our pharmacist will contact you about this.",
    "admin": "Thank you. Our admin team will deal with this and get back to you.",
    "self_care": "Thank you. This usually gets better at home. We will send you self-care advice, and please contact us again if it gets worse.",
    "urgent_111": "Please call 111 now, or 999 if you think life is at risk.",
}

# Red flags run before any AI. Each rule is (name, pattern, reply).
_EMERGENCY_REPLY = (
    "This could be an emergency. Please call 999 now. "
    "If you are not sure, call 111. Do not wait for us to call back."
)
RED_FLAGS = [
    ("chest pain", r"\bchest (pain|pains|tightness)\b|\bpain in (my|his|her|their) chest\b|\bheart attack\b", _EMERGENCY_REPLY),
    ("breathing", r"\b(can'?t|cannot|can ?not|struggling to|unable to|hard to) breathe?\b(?! through)|\bnot breathing\b|\bgasping\b|\bturning blue\b|\blips (are |have gone )?blue\b", _EMERGENCY_REPLY),
    ("stroke signs", r"\bhaving a stroke\b|\bsigns of (a )?stroke\b|\bface (is )?(drooping|droopy|fallen)\b|\bslurred speech\b|\bslurring\b|\b(arm|leg|one side) (has gone )?(weak|numb|floppy)\b", _EMERGENCY_REPLY),
    ("heavy bleeding", r"\b(heavy|heavily|severe|lots of|a lot of) bleeding\b|\bbleeding (heavily|a lot|badly)\b|\b(won'?t|will not|doesn'?t) stop bleeding\b|\bcoughing up blood\b|\bvomiting blood\b", _EMERGENCY_REPLY),
    ("collapse or fit", r"\bunconscious\b|\bcollapsed\b|\bpassed out\b|\bseizure\b|\bhaving a fit\b|\bwon'?t wake up\b", _EMERGENCY_REPLY),
    ("severe allergy", r"\banaphyla\w*\b|\b(throat|tongue|lips?) (is |are )?(swell\w*|swollen)\b", _EMERGENCY_REPLY),
    ("meningitis rash", r"\brash (that )?(doesn'?t|does not|won'?t) fade\b|\bglass test\b", _EMERGENCY_REPLY),
    (
        "suicidal thoughts",
        r"\bsuicid\w*\b|\bkill myself\b|\bend(ing)? (it all|my life)\b|\btake my (own )?life\b|\bdon'?t want to (be alive|live)\b|\bself[- ]harm\w*\b|\bhurt myself\b",
        "Please call 999 now if you are in danger. You can also call 111 and choose the mental health option, "
        "or call Samaritans on 116 123, any time. You are not alone.",
    ),
]
_RED_FLAG_PATTERNS = [(name, re.compile(pattern, re.IGNORECASE), reply) for name, pattern, reply in RED_FLAGS]


def check_red_flags(text):
    """Return (rule name, reply) for the first red flag in the text, or None."""
    normalised = text.replace("’", "'")
    for name, pattern, reply in _RED_FLAG_PATTERNS:
        if pattern.search(normalised):
            return name, reply
    return None


def build_user_message(text):
    return "Patient request:\n" + text.strip()


def build_messages(text):
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_message(text)},
    ]


def parse_answer(content):
    """Parse the model's JSON. Raise ValueError when the shape is wrong."""
    content = (content or "").strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content)
    try:
        data = json.loads(content)
    except json.JSONDecodeError as err:
        raise ValueError(f"not JSON: {err}") from err
    if not isinstance(data, dict):
        raise ValueError("not a JSON object")
    route = str(data.get("route", "")).strip().lower()
    if route not in ROUTES:
        raise ValueError(f"unknown route: {route!r}")
    reply = str(data.get("reply", "")).strip()
    if not reply:
        raise ValueError("empty reply")
    sure = str(data.get("sure", "")).strip().lower()
    if sure not in SURE_LEVELS:
        sure = "low"
    return {"route": route, "reply": reply, "sure": sure}


def parse_served_by(header_value):
    """'small' when Mubit's small model (vLLM) answered, else 'big'."""
    return "small" if "vllm" in (header_value or "").lower() else "big"


def parse_trace_id(headers):
    """The trc_ trace id; starter-credit calls only carry the mreq_ request id, so fall back to it."""
    return headers.get("x-middleware-trace") or headers.get("x-middleware-request-id") or ""


def short_trace(trace_id):
    """Keep the prefix and the last 6 characters: ids share their time-based start."""
    if not trace_id or len(trace_id) <= 14:
        return trace_id or ""
    prefix = trace_id.split("_", 1)[0] + "_" if "_" in trace_id else ""
    return prefix + "…" + trace_id[-6:]


_client = None


def get_client():
    global _client
    if _client is None:
        api_key = os.environ.get("MUBIT_API_KEY")
        if not api_key:
            raise RuntimeError("MUBIT_API_KEY is not set. Copy .env.example to .env and add the key.")
        from openai import OpenAI

        _client = OpenAI(api_key=api_key, base_url=MUBIT_BASE_URL, timeout=30, max_retries=1)
    return _client


def call_mubit(text, client=None, session_id=None, store=None):
    """One Mubit call. Same model, system prompt and output format every time."""
    client = client or get_client()
    kwargs = {
        "model": MODEL,
        "messages": build_messages(text),
        "response_format": {"type": "json_object"},
    }
    if STORE if store is None else store:
        kwargs["store"] = True
        # The provider only accepts metadata together with store.
        if session_id:
            kwargs["metadata"] = {"session_id": session_id}
    started = time.perf_counter()
    raw = client.chat.completions.with_raw_response.create(**kwargs)
    latency_ms = round((time.perf_counter() - started) * 1000)
    completion = raw.parse()
    served_by_header = raw.headers.get("x-middleware-served-by") or ""
    return {
        "content": completion.choices[0].message.content,
        "served_by": parse_served_by(served_by_header),
        "served_by_header": served_by_header,
        "trace_id": parse_trace_id(raw.headers),
        "latency_ms": latency_ms,
    }


def triage(text, client=None, session_id=None):
    """Red flags first; otherwise ask Mubit. Returns one inbox-ready answer."""
    text = text.strip()
    flag = check_red_flags(text)
    if flag:
        name, reply = flag
        return {
            "route": "urgent_111",
            "reply": reply,
            "sure": "high",
            "served_by": "rule",
            "rule": name,
            "trace_id": "",
            "latency_ms": 0,
            "needs_person": False,
            "error": "",
        }
    result = call_mubit(text, client=client, session_id=session_id)
    try:
        answer = parse_answer(result["content"])
        error = ""
    except ValueError as err:
        answer = {
            "route": "",
            "reply": "Thank you. A member of our team will read your request and get back to you today.",
            "sure": "low",
        }
        error = str(err)
    return {
        **answer,
        "served_by": result["served_by"],
        "rule": "",
        "trace_id": result["trace_id"],
        "latency_ms": result["latency_ms"],
        "needs_person": answer["sure"] == "low" or not answer["route"],
        "error": error,
    }
