import pytest
from pydantic import ValidationError

from server.schemas import AnalyzeCommand


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
