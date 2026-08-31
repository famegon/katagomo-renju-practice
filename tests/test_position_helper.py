from __future__ import annotations

import json
import subprocess
from typing import Any

import pytest

from server.config import PROJECT_ROOT


HELPER = PROJECT_ROOT / "build/forbidden-helper/forbidden_helper"
FORBIDDEN_CASES_PATH = (
    PROJECT_ROOT / "tests/fixtures/renju_forbidden_cases.json"
)
TERMINAL_CASES_PATH = PROJECT_ROOT / "tests/fixtures/renju_terminal_cases.json"

FORBIDDEN_CASES = {
    case["name"]: case
    for case in json.loads(FORBIDDEN_CASES_PATH.read_text(encoding="utf-8"))[
        "cases"
    ]
}
TERMINAL_CASES = {
    case["name"]: case
    for case in json.loads(TERMINAL_CASES_PATH.read_text(encoding="utf-8"))[
        "cases"
    ]
}


BLACK_FIVE = [
    ["B", "D8"],
    ["W", "A1"],
    ["B", "E8"],
    ["W", "C1"],
    ["B", "F8"],
    ["W", "E1"],
    ["B", "G8"],
    ["W", "G1"],
    ["B", "H8"],
]

WHITE_FIVE = [
    ["B", "A15"],
    ["W", "D8"],
    ["B", "C15"],
    ["W", "E8"],
    ["B", "E15"],
    ["W", "F8"],
    ["B", "G15"],
    ["W", "G8"],
    ["B", "J15"],
    ["W", "H8"],
]

# White wins with six in a row under Renju (RIF rule 9.1). The gap at G8
# prevents the five existing before the final move.
WHITE_OVERLINE = [
    ["B", "A15"],
    ["W", "D8"],
    ["B", "C15"],
    ["W", "E8"],
    ["B", "E15"],
    ["W", "F8"],
    ["B", "G15"],
    ["W", "H8"],
    ["B", "J15"],
    ["W", "J8"],
    ["B", "L15"],
    ["W", "G8"],
]

# The same six-stone geometry is a forbidden-move loss for black.
BLACK_OVERLINE = [
    ["B", "D8"],
    ["W", "A1"],
    ["B", "E8"],
    ["W", "C1"],
    ["B", "F8"],
    ["W", "E1"],
    ["B", "H8"],
    ["W", "G1"],
    ["B", "J8"],
    ["W", "J1"],
    ["B", "G8"],
]

# H8 simultaneously completes an exact horizontal five and creates two
# additional fours. RIF rule 9.2 gives exact five precedence, mirrored by the
# official ForbiddenPointFinder IsDoubleThree/IsDoubleFour early return.
EXACT_FIVE_PRECEDENCE = [
    ["B", "D8"],
    ["W", "A1"],
    ["B", "E8"],
    ["W", "C1"],
    ["B", "F8"],
    ["W", "E1"],
    ["B", "G8"],
    ["W", "G1"],
    ["B", "H5"],
    ["W", "J1"],
    ["B", "H6"],
    ["W", "L1"],
    ["B", "H7"],
    ["W", "N1"],
    ["B", "E11"],
    ["W", "P1"],
    ["B", "F10"],
    ["W", "A3"],
    ["B", "G9"],
    ["W", "C3"],
    ["B", "H8"],
]


def _next_player(moves: list[list[str]]) -> str:
    return "B" if len(moves) % 2 == 0 else "W"


def run_helper(
    moves: list[list[str]], *, check: bool = True
) -> subprocess.CompletedProcess[str]:
    assert HELPER.is_file(), "run make forbidden-helper first"
    return subprocess.run(
        [str(HELPER)],
        input=json.dumps(
            {
                "boardXSize": 15,
                "boardYSize": 15,
                "moves": moves,
                "nextPlayer": _next_player(moves),
            }
        ),
        text=True,
        capture_output=True,
        check=check,
    )


def helper_json(moves: list[list[str]]) -> dict[str, Any]:
    return json.loads(run_helper(moves).stdout)


def assert_common_contract(
    response: dict[str, Any], moves: list[list[str]]
) -> None:
    assert response["boardXSize"] == 15
    assert response["boardYSize"] == 15
    assert response["rules"] == "renju"
    assert response["isValid"] is True
    assert response["moveCount"] == len(moves)
    assert response["nextPlayer"] == _next_player(moves)
    assert response["source"] == "KataGomo Board::isForbidden()"
    assert response["historySource"] == (
        "KataGomo BoardHistory::makeBoardMoveAssumeLegal()"
    )

    occupied = {move for _, move in moves}
    forbidden = set(response["forbiddenMoves"])
    legal = set(response["legalMoves"])
    assert forbidden.isdisjoint(legal)
    assert occupied.isdisjoint(forbidden | legal)

    if response["isTerminal"]:
        assert response["outcome"] != "ongoing"
        assert response["terminalReason"] is not None
        assert response["terminalMove"] == moves[-1][1]
        assert forbidden == set()
        assert legal == set()
    else:
        assert response["winner"] is None
        assert response["outcome"] == "ongoing"
        assert response["terminalReason"] is None
        assert response["terminalMove"] is None
        assert len(forbidden | legal) == 225 - len(occupied)


def assert_position(
    moves: list[list[str]],
    *,
    terminal: bool,
    winner: str | None,
    outcome: str,
    reason: str | None,
) -> dict[str, Any]:
    response = helper_json(moves)
    assert_common_contract(response, moves)
    assert response["isTerminal"] is terminal
    assert response["winner"] == winner
    assert response["outcome"] == outcome
    assert response["terminalReason"] == reason
    return response


def test_empty_position_is_ongoing() -> None:
    response = assert_position(
        [], terminal=False, winner=None, outcome="ongoing", reason=None
    )
    assert response["forbiddenMoves"] == []
    assert "H8" in response["legalMoves"]


@pytest.mark.parametrize(
    ("name", "moves", "winner", "outcome"),
    [
        ("black-five", BLACK_FIVE, "B", "black_win"),
        ("white-five", WHITE_FIVE, "W", "white_win"),
        ("white-overline", WHITE_OVERLINE, "W", "white_win"),
    ],
)
def test_line_wins(
    name: str,
    moves: list[list[str]],
    winner: str,
    outcome: str,
) -> None:
    del name
    assert_position(
        moves,
        terminal=True,
        winner=winner,
        outcome=outcome,
        reason="line_win",
    )


@pytest.mark.parametrize(
    ("name", "moves"),
    [
        ("black-overline", BLACK_OVERLINE),
        (
            "double-three",
            FORBIDDEN_CASES["double-three"]["moves"] + [["B", "M5"]],
        ),
        (
            "double-four",
            FORBIDDEN_CASES["double-four"]["moves"] + [["B", "E14"]],
        ),
    ],
)
def test_black_forbidden_moves_end_as_white_win(
    name: str, moves: list[list[str]]
) -> None:
    del name
    assert_position(
        moves,
        terminal=True,
        winner="W",
        outcome="white_win",
        reason="black_forbidden",
    )


def test_fake_open_three_remains_ongoing() -> None:
    moves = FORBIDDEN_CASES["fake-open-three"]["moves"] + [["B", "C3"]]
    response = assert_position(
        moves, terminal=False, winner=None, outcome="ongoing", reason=None
    )
    assert "C3" not in response["forbiddenMoves"]
    assert "C3" not in response["legalMoves"]


def test_white_is_not_subject_to_black_forbidden_rules() -> None:
    moves = FORBIDDEN_CASES[
        "white-does-not-use-black-forbidden-rule"
    ]["moves"] + [["W", "M5"]]
    assert_position(
        moves, terminal=False, winner=None, outcome="ongoing", reason=None
    )


def test_exact_five_takes_precedence_over_fork_shapes() -> None:
    assert_position(
        EXACT_FIVE_PRECEDENCE,
        terminal=True,
        winner="B",
        outcome="black_win",
        reason="line_win",
    )


def test_full_board_draw_from_verified_fixture() -> None:
    case = TERMINAL_CASES["board-full-draw"]
    response = helper_json(case["moves"])
    assert_common_contract(response, case["moves"])
    for field, expected in case["expected"].items():
        assert response[field] == expected


def test_one_move_before_full_board_is_still_ongoing() -> None:
    moves = TERMINAL_CASES["board-full-draw"]["moves"][:-1]
    response = assert_position(
        moves, terminal=False, winner=None, outcome="ongoing", reason=None
    )
    assert response["legalMoves"] == [
        TERMINAL_CASES["board-full-draw"]["moves"][-1][1]
    ]
    assert response["forbiddenMoves"] == []


def test_move_after_terminal_position_is_rejected() -> None:
    result = run_helper(BLACK_FIVE + [["W", "A2"]], check=False)
    assert result.returncode != 0
    assert result.stdout == ""
    assert "move 10 was played after the game ended" in result.stderr
