import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import tariff  # noqa: E402


@pytest.fixture(autouse=True)
def temp_logs(tmp_path, monkeypatch):
    """Point the call and correction logs at a temp folder so tests never touch data/."""
    monkeypatch.setattr(tariff, "CALLS_LOG", tmp_path / "calls.jsonl")
    monkeypatch.setattr(tariff, "CORRECTIONS_LOG", tmp_path / "corrections.jsonl")
    return tmp_path
