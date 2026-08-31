import pytest
from pydantic import ValidationError

from server.schemas import AnalyzeCommand, RenjuPositionState


COLUMNS = "ABCDEFGHJKLMNOP"


def empty_position_state() -> dict:
    return {
        "boardXSize": 15,
        "boardYSize": 15,
        "rules": "renju",
        "isValid": True,
        "moveCount": 0,
        "nextPlayer": "B",
        "isTerminal": False,
        "winner": None,
        "outcome": "ongoing",
        "terminalReason": None,
        "terminalMove": None,
        "forbiddenMoves": [],
        "legalMoves": [
            f"{column}{row}" for row in range(1, 16) for column in COLUMNS
        ],
        "source": "KataGomo Board::isForbidden()",
        "historySource": (
            "KataGomo BoardHistory::makeBoardMoveAssumeLegal()"
        ),
    }


def test_move_sequence_normalizes_and_serializes_to_engine_json_shape():
    command = AnalyzeCommand.model_validate(
        {"action": "analyze", "moves": [["B", "h8"], ["W", "j9"]]}
    )

    payload = command.model_dump(mode="json")
    assert payload["moves"] == [["B", "H8"], ["W", "J9"]]
    assert payload["boardXSize"] == 15
    assert payload["boardYSize"] == 15
    assert payload["rules"] == "renju"
    assert payload["maxVisits"] == 100
    assert payload["reportDuringSearchEvery"] == 0.5
    assert payload["analysisPurpose"] == "manual"
    assert payload["positionRevision"] == 0
    assert payload["sessionEpoch"] is None


@pytest.mark.parametrize(
    "moves",
    [
        [["W", "H8"]],
        [["B", "H8"], ["B", "H9"]],
        [["B", "H8"], ["W", "H8"]],
    ],
)
def test_move_sequence_rejects_wrong_turns_and_duplicates(moves):
    with pytest.raises(ValidationError):
        AnalyzeCommand.model_validate({"action": "analyze", "moves": moves})


def test_position_contract_covers_every_empty_intersection():
    state = RenjuPositionState.model_validate(empty_position_state())
    assert len(state.legalMoves) == 225

    incomplete = empty_position_state()
    incomplete["legalMoves"] = incomplete["legalMoves"][:-1]
    with pytest.raises(ValidationError, match="cover every empty point"):
        RenjuPositionState.model_validate(incomplete)


def test_position_contract_rejects_inconsistent_terminal_outcome():
    state = empty_position_state()
    state.update(
        {
            "moveCount": 9,
            "nextPlayer": "W",
            "isTerminal": True,
            "winner": "B",
            "outcome": "black_win",
            "terminalReason": "black_forbidden",
            "terminalMove": "H8",
            "legalMoves": [],
        }
    )
    with pytest.raises(ValidationError, match="black_win requires"):
        RenjuPositionState.model_validate(state)
