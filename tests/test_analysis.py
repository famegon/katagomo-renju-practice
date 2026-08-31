import pytest

from server.analysis import (
    AnalysisProtocolError,
    calculate_visit_shares,
    transform_analysis_response,
    winrate_for_player,
)


def valid_analysis_response():
    policy = [0.0] * 226
    policy[112] = 0.61
    return {
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
                "pvVisits": [4],
                "pvEdgeVisits": [4],
            }
        ],
        "policy": policy,
        "rootInfo": {"currentPlayer": "B", "visits": 4, "winrate": 0.7},
    }


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
    raw = valid_analysis_response()
    raw["rootInfo"]["currentPlayer"] = "W"
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


@pytest.mark.parametrize("value", [None, "false", 0, 1, [], {}])
def test_is_during_search_requires_a_real_boolean(value):
    raw = valid_analysis_response()
    raw["isDuringSearch"] = value
    with pytest.raises(AnalysisProtocolError, match="isDuringSearch"):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize("value", ["true", 1, [], {}])
def test_no_results_rejects_non_boolean_values(value):
    raw = valid_analysis_response()
    raw["noResults"] = value
    with pytest.raises(AnalysisProtocolError, match="noResults"):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize("policy", [None, [], [0.0] * 225, [0.0] * 227])
def test_malformed_policy_is_a_protocol_error(policy):
    raw = valid_analysis_response()
    raw["policy"] = policy
    with pytest.raises(AnalysisProtocolError, match="policy length must be 226"):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize("root_info", [None, [], "not-an-object", 7])
def test_malformed_root_info_is_a_protocol_error(root_info):
    raw = valid_analysis_response()
    raw["rootInfo"] = root_info
    with pytest.raises(AnalysisProtocolError, match="rootInfo must be an object"):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("currentPlayer", "X"),
        ("currentPlayer", 1),
        ("winrate", "not-a-number"),
        ("winrate", float("nan")),
        ("winrate", float("inf")),
        ("winrate", 1.1),
        ("visits", "not-an-integer"),
        ("visits", 1.5),
        ("visits", 10**1000),
    ],
)
def test_malformed_root_fields_are_protocol_errors(field, value):
    raw = valid_analysis_response()
    raw["rootInfo"][field] = value
    with pytest.raises(AnalysisProtocolError):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize("field", ["currentPlayer", "winrate", "visits"])
def test_missing_required_root_fields_are_protocol_errors(field):
    raw = valid_analysis_response()
    del raw["rootInfo"][field]
    with pytest.raises(AnalysisProtocolError, match=field):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize("move_infos", [{}, "not-an-array", [None], ["bad"]])
def test_malformed_move_infos_shape_is_a_protocol_error(move_infos):
    raw = valid_analysis_response()
    raw["moveInfos"] = move_infos
    with pytest.raises(AnalysisProtocolError, match="moveInfos"):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("visits", "not-an-integer"),
        ("visits", 1.5),
        ("visits", float("inf")),
        ("winrate", "not-a-number"),
        ("winrate", float("nan")),
        ("winrate", -0.1),
        ("prior", {}),
        ("prior", 10**1000),
    ],
)
def test_malformed_candidate_numbers_are_protocol_errors(field, value):
    raw = valid_analysis_response()
    raw["moveInfos"][0][field] = value
    with pytest.raises(AnalysisProtocolError):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize(
    "field", ["move", "order", "prior", "visits", "winrate", "pv", "pvVisits", "pvEdgeVisits"]
)
def test_missing_required_candidate_fields_are_protocol_errors(field):
    raw = valid_analysis_response()
    del raw["moveInfos"][0][field]
    with pytest.raises(AnalysisProtocolError, match=field):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


def test_missing_move_infos_is_a_protocol_error():
    raw = valid_analysis_response()
    del raw["moveInfos"]
    with pytest.raises(AnalysisProtocolError, match="moveInfos"):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize(
    "value",
    ["not-a-number", None, True, float("nan"), float("inf"), 10**1000],
)
def test_malformed_policy_numbers_are_protocol_errors(value):
    raw = valid_analysis_response()
    raw["policy"][112] = value
    with pytest.raises(AnalysisProtocolError):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


def test_nested_non_finite_engine_value_is_a_protocol_error():
    raw = valid_analysis_response()
    raw["moveInfos"][0]["pvVisits"] = [4, float("nan")]
    with pytest.raises(AnalysisProtocolError, match="non-finite"):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("order", None),
        ("order", -1),
        ("order", 1.5),
        ("order", True),
        ("pvVisits", "not-an-array"),
        ("pvVisits", [1, -1]),
        ("pvVisits", [1.5]),
        ("pvEdgeVisits", None),
        ("pvEdgeVisits", [True]),
    ],
)
def test_malformed_candidate_search_metadata_is_a_protocol_error(field, value):
    raw = valid_analysis_response()
    raw["moveInfos"][0][field] = value
    with pytest.raises(AnalysisProtocolError, match=field):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


@pytest.mark.parametrize("pv", ["H8", [None], ["I8"], ["H16"]])
def test_malformed_candidate_pv_is_a_protocol_error(pv):
    raw = valid_analysis_response()
    raw["moveInfos"][0]["pv"] = pv
    with pytest.raises(AnalysisProtocolError, match="pv"):
        transform_analysis_response(raw, request_id="public-1", user_color="B")


def test_candidate_and_pv_allow_pass_from_the_real_engine_contract():
    raw = valid_analysis_response()
    raw["moveInfos"][0].update(
        {
            "move": "pass",
            "pv": ["pass"],
            "pvVisits": [4],
            "pvEdgeVisits": [4],
        }
    )
    raw["policy"][225] = 0.03
    result = transform_analysis_response(raw, request_id="public-1", user_color="B")
    assert result["candidates"][0]["move"] == "pass"
    assert result["candidates"][0]["pv"] == ["pass"]
    assert result["candidates"][0]["rawPrior"] == pytest.approx(0.03)
