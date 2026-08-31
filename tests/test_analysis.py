import pytest

from server.analysis import (
    AnalysisProtocolError,
    calculate_visit_shares,
    transform_analysis_response,
    winrate_for_player,
)


def test_visit_share_uses_candidate_sum():
    shares, total = calculate_visit_shares(
        [{"visits": 6}, {"visits": 3}, {"visits": 1}]
    )
    assert total == 10
    assert shares == pytest.approx([0.6, 0.3, 0.1])


def test_visit_share_zero_denominator():
    shares, total = calculate_visit_shares([{"visits": 0}, {"visits": 0}])
    assert total == 0
    assert shares == [0.0, 0.0]


def test_black_to_current_player_perspective():
    assert winrate_for_player(0.73, "B") == pytest.approx(0.73)
    assert winrate_for_player(0.73, "W") == pytest.approx(0.27)


def test_white_user_perspective_and_raw_policy_contract():
    policy = [0.0] * 226
    policy[112] = 0.61
    raw = {
        "id": "engine-1",
        "isDuringSearch": False,
        "moveInfos": [
            {
                "move": "H8",
                "order": 0,
                "prior": 0.42,
                "visits": 4,
                "winrate": 0.72,
                "pv": ["H8"],
            }
        ],
        "policy": policy,
        "rootInfo": {"currentPlayer": "W", "visits": 4, "winrate": 0.7},
    }
    result = transform_analysis_response(raw, request_id="public-1", user_color="W")
    candidate = result["candidates"][0]
    assert candidate["rawPrior"] == pytest.approx(0.61)
    assert candidate["searchPrior"] == pytest.approx(0.42)
    assert candidate["blackWinrate"] == pytest.approx(0.72)
    assert candidate["currentPlayerWinrate"] == pytest.approx(0.28)
    assert candidate["userWinrate"] == pytest.approx(0.28)
    assert result["rootInfo"]["userWinrate"] == pytest.approx(0.3)
    assert result["policyLength"] == 226


def test_zero_visits_marks_analysis_insufficient():
    raw = {
        "id": "engine-1",
        "isDuringSearch": True,
        "moveInfos": [],
        "policy": [0.0] * 226,
        "rootInfo": {"currentPlayer": "B", "visits": 0, "winrate": 0.5},
    }
    result = transform_analysis_response(raw, request_id="public-1", user_color="B")
    assert result["analysisInsufficient"] is True
    assert result["analysisState"] == "insufficient"


def test_no_results_is_interruption_not_a_game_result():
    result = transform_analysis_response(
        {"id": "engine-1", "turnNumber": 9, "noResults": True},
        request_id="public-1",
        user_color="B",
    )
    assert result == {
        "type": "analysis",
        "requestId": "public-1",
        "turnNumber": 9,
        "isDuringSearch": False,
        "isFinal": True,
        "analysisState": "canceled",
        "analysisInsufficient": True,
        "noResults": True,
    }
    assert "winner" not in result


@pytest.mark.parametrize("policy", [None, [], [0.0] * 225, [0.0] * 227])
def test_malformed_policy_is_a_protocol_error(policy):
    raw = {
        "id": "engine-1",
        "isDuringSearch": False,
        "moveInfos": [
            {"move": "H8", "prior": 0.9, "visits": 1, "winrate": 0.5}
        ],
        "policy": policy,
        "rootInfo": {"currentPlayer": "B", "visits": 1, "winrate": 0.5},
    }
    with pytest.raises(AnalysisProtocolError, match="policy length must be 226"):
        transform_analysis_response(raw, request_id="public-1", user_color="B")
