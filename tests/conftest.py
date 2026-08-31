from __future__ import annotations

from pathlib import Path

import pytest

from server.config import PROJECT_ROOT, Settings


@pytest.fixture
def fake_settings(tmp_path: Path) -> Settings:
    model = tmp_path / "model.bin.gz"
    config = tmp_path / "analysis.cfg"
    model.write_bytes(b"fake")
    config.write_text("fake = true\n", encoding="utf-8")
    return Settings(
        engine_path=PROJECT_ROOT / "tests/fixtures/fake_analysis_engine.py",
        model_path=model,
        analysis_config_path=config,
        forbidden_helper_path=tmp_path / "forbidden_helper",
        engine_stderr_path=tmp_path / "engine-stderr.log",
    )

