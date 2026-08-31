from __future__ import annotations

from pathlib import Path
import sys

import pytest

from server.config import PROJECT_ROOT, Settings


@pytest.fixture
def fake_settings(tmp_path: Path) -> Settings:
    model = tmp_path / "model.bin.gz"
    config = tmp_path / "analysis.cfg"
    model.write_bytes(b"fake")
    config.write_text("fake = true\n", encoding="utf-8")
    helper = tmp_path / "forbidden_helper"
    helper.write_text(
        f"""#!{sys.executable}
import json
import sys

request = json.load(sys.stdin)
moves = request.get("moves", [])
columns = "ABCDEFGHJKLMNOP"
occupied = {{move for _, move in moves}}
legal = [
    f"{{column}}{{row}}"
    for row in range(1, 16)
    for column in columns
    if f"{{column}}{{row}}" not in occupied
]
json.dump({{
    "boardXSize": 15,
    "boardYSize": 15,
    "rules": "renju",
    "isValid": True,
    "moveCount": len(moves),
    "nextPlayer": request.get("nextPlayer", "B"),
    "isTerminal": False,
    "winner": None,
    "outcome": "ongoing",
    "terminalReason": None,
    "terminalMove": None,
    "forbiddenMoves": [],
    "legalMoves": legal,
    "source": "KataGomo Board::isForbidden()",
    "historySource": "KataGomo BoardHistory::makeBoardMoveAssumeLegal()",
}}, sys.stdout)
""",
        encoding="utf-8",
    )
    helper.chmod(0o755)
    return Settings(
        engine_path=PROJECT_ROOT / "tests/fixtures/fake_analysis_engine.py",
        model_path=model,
        analysis_config_path=config,
        forbidden_helper_path=helper,
        engine_stderr_path=tmp_path / "engine-stderr.log",
    )
