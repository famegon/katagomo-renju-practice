from __future__ import annotations

import json
import subprocess

import pytest

from server.config import PROJECT_ROOT


HELPER = PROJECT_ROOT / "build/forbidden-helper/forbidden_helper"
CASES = PROJECT_ROOT / "tests/fixtures/renju_forbidden_cases.json"


def run_helper(case):
    result = subprocess.run(
        [str(HELPER)],
        input=json.dumps(
            {
                "boardXSize": 15,
                "boardYSize": 15,
                "moves": case["moves"],
                "nextPlayer": case["nextPlayer"],
            }
        ),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


@pytest.mark.parametrize(
    "case",
    json.loads(CASES.read_text(encoding="utf-8"))["cases"],
    ids=lambda case: case["name"],
)
def test_board_forbidden_cases_from_documented_sources(case):
    assert HELPER.is_file(), "run make forbidden-helper first"
    response = run_helper(case)
    forbidden = set(response["forbiddenMoves"])
    legal = set(response["legalMoves"])
    assert response["source"] == "KataGomo Board::isForbidden()"
    assert response["nextPlayer"] == case["nextPlayer"]
    assert set(case["mustBeForbidden"]) <= forbidden
    assert set(case["mustBeLegal"]) <= legal
    assert forbidden.isdisjoint(legal)
    if case["nextPlayer"] == "W":
        assert forbidden == set()


def test_helper_rejects_duplicate_moves():
    request = {
        "moves": [["B", "H8"], ["W", "H8"]],
        "nextPlayer": "B",
    }
    result = subprocess.run(
        [str(HELPER)],
        input=json.dumps(request),
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert "duplicate" in result.stderr
