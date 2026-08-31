from __future__ import annotations

import pytest

from server.coordinates import coordinate_to_policy_index
from server.training import (
    DEFAULT_END_PLY,
    END_PLY_OPTIONS,
    evaluate_training_move,
    has_reached_end_ply,
    select_end_ply,
    summarize_top_mistakes,
)


def _policy(**moves: float) -> list[float]:
    policy = [0.0] * 226
    for move, value in moves.items():
        policy[coordinate_to_policy_index(move)] = value
    return policy


def _analysis(
    *,
    policy: list[float] | None = None,
    candidates: list[dict] | None = None,
    black_winrate: float = 0.60,
    root_visits: int = 101,
    insufficient: bool = False,
) -> dict:
    return {
        "isFinal": True,
        "policy": policy or _policy(H8=0.40, J8=0.25, G8=0.10),
        "candidates": candidates
        if candidates is not None
        else [
            {
                "move": "H8",
                "order": 0,
                "visits": 60,
                "blackWinrate": 0.64,
            },
            {
                "move": "J8",
                "order": 1,
                "visits": 30,
                "blackWinrate": 0.57,
            },
            {
                "move": "G8",
                "order": 2,
                "visits": 10,
                "blackWinrate": 0.53,
            },
        ],
        "rootInfo": {"blackWinrate": black_winrate, "visits": root_visits},
        "analysisInsufficient": insufficient,
    }


def test_black_move_contract_uses_full_policy_and_candidate_order():
    result = evaluate_training_move(
        ply=5,
        user_move="j8",
        user_color="B",
        pre_analysis=_analysis(),
        post_root_info={"blackWinrate": 0.55, "visits": 120},
        minimum_candidate_visits=100,
    )

    assert result["userMove"] == "J8"
    assert result["recommendedMove"] == "H8"
    assert result["rawPolicy"] == pytest.approx(0.25)
    assert result["policyRank"] == 2
    assert result["visitRank"] == 2
    assert result["visitRankSource"] == "visits"
    assert result["searchOrder"] == 2
    assert result["recommendedVisitRank"] == 1
    assert result["visitRankDifference"] == 1
    assert result["visitRankGap"] == 1
    assert result["candidateVisits"] == 30
    assert result["candidateVisitTotal"] == 100
    assert result["recommendedVisits"] == 60
    assert result["preRootVisits"] == 101
    assert result["postRootVisits"] == 120
    assert result["beforeUserWinrate"] == pytest.approx(0.60)
    assert result["afterUserWinrate"] == pytest.approx(0.55)
    assert result["winrateDelta"] == pytest.approx(-0.05)
    assert result["recommendedUserWinrate"] == pytest.approx(0.64)
    assert result["chosenExpectedUserWinrate"] == pytest.approx(0.57)
    assert result["winrateLoss"] == pytest.approx(0.07)
    assert result["winrateLossSource"] == "pre-move-candidates"
    assert result["analysisInsufficient"] is False
    assert result["isMistake"] is True


def test_white_perspective_flips_before_after_and_candidate_comparison():
    candidates = [
        {"move": "H8", "order": 0, "visits": 70, "blackWinrate": 0.42},
        {"move": "J8", "order": 1, "visits": 30, "blackWinrate": 0.50},
    ]
    result = evaluate_training_move(
        ply=6,
        user_move="J8",
        user_color="W",
        pre_analysis=_analysis(candidates=candidates, black_winrate=0.45),
        post_root_info={"blackWinrate": 0.52, "visits": 100},
    )

    assert result["beforeUserWinrate"] == pytest.approx(0.55)
    assert result["afterUserWinrate"] == pytest.approx(0.48)
    assert result["winrateDelta"] == pytest.approx(-0.07)
    assert result["recommendedUserWinrate"] == pytest.approx(0.58)
    assert result["chosenExpectedUserWinrate"] == pytest.approx(0.50)
    assert result["winrateLoss"] == pytest.approx(0.08)


def test_move_missing_from_candidates_uses_post_root_without_fabricating_rank():
    result = evaluate_training_move(
        ply=7,
        user_move="G8",
        user_color="B",
        pre_analysis=_analysis(
            candidates=[
                {"move": "H8", "order": 0, "visits": 80, "blackWinrate": 0.64},
                {"move": "J8", "order": 1, "visits": 20, "blackWinrate": 0.57},
            ]
        ),
        post_root_info={"blackWinrate": 0.50, "visits": 100},
    )

    assert result["policyRank"] == 3
    assert result["visitRank"] is None
    assert result["visitRankGap"] is None
    assert result["candidateVisits"] is None
    assert result["chosenExpectedUserWinrate"] is None
    assert result["winrateLoss"] == pytest.approx(0.14)
    assert result["winrateLossSource"] == "post-move-root"
    assert result["analysisInsufficient"] is True
    assert "chosen-move-not-in-candidates" in result["analysisInsufficientReasons"]
    assert result["isMistake"] is None


@pytest.mark.parametrize(
    ("candidates", "minimum", "expected_reason"),
    [
        ([], 1, "zero-candidate-visits"),
        ([{"move": "H8", "order": 0, "visits": 20, "blackWinrate": 0.6}], 50,
         "below-minimum-candidate-visits"),
    ],
)
def test_insufficient_candidate_analysis_is_not_confidently_scored(
    candidates, minimum, expected_reason
):
    result = evaluate_training_move(
        ply=3,
        user_move="H8",
        user_color="B",
        pre_analysis=_analysis(candidates=candidates),
        post_root_info={"blackWinrate": 0.50, "visits": 20},
        minimum_candidate_visits=minimum,
    )

    assert result["analysisInsufficient"] is True
    assert expected_reason in result["analysisInsufficientReasons"]
    assert result["isMistake"] is None


def test_partial_pre_move_analysis_is_marked_insufficient():
    analysis = _analysis()
    analysis["isFinal"] = False
    result = evaluate_training_move(
        ply=3,
        user_move="H8",
        user_color="B",
        pre_analysis=analysis,
        post_root_info={"blackWinrate": 0.61, "visits": 100},
        minimum_candidate_visits=50,
    )

    assert result["analysisInsufficient"] is True
    assert "pre-analysis-not-final" in result["analysisInsufficientReasons"]
    assert result["isMistake"] is None


def test_missing_final_marker_is_marked_insufficient():
    analysis = _analysis()
    del analysis["isFinal"]
    result = evaluate_training_move(
        ply=3,
        user_move="H8",
        user_color="B",
        pre_analysis=analysis,
        post_root_info={"blackWinrate": 0.61, "visits": 100},
        minimum_candidate_visits=50,
    )

    assert result["analysisInsufficient"] is True
    assert "pre-analysis-not-final" in result["analysisInsufficientReasons"]


def test_training_ply_and_position_players_must_match_user_color():
    with pytest.raises(ValueError, match="ply 6 must be a W user move"):
        evaluate_training_move(
            ply=6,
            user_move="H8",
            user_color="B",
            pre_analysis=_analysis(),
            post_root_info={"blackWinrate": 0.5, "visits": 100},
        )

    analysis = _analysis()
    analysis.update({"currentPlayer": "W", "turnNumber": 4})
    with pytest.raises(ValueError, match="currentPlayer must be B"):
        evaluate_training_move(
            ply=5,
            user_move="H8",
            user_color="B",
            pre_analysis=analysis,
            post_root_info={"blackWinrate": 0.5, "visits": 100},
        )

    analysis = _analysis()
    analysis["turnNumber"] = 99
    with pytest.raises(ValueError, match="turnNumber must be 4"):
        evaluate_training_move(
            ply=5,
            user_move="H8",
            user_color="B",
            pre_analysis=analysis,
            post_root_info={"blackWinrate": 0.5, "visits": 100},
        )


def test_policy_rank_uses_all_board_entries_and_gives_ties_same_rank():
    policy = _policy(H8=0.4, J8=0.25, G8=0.25, K8=0.2, A1=0.1)
    result = evaluate_training_move(
        ply=5,
        user_move="G8",
        user_color="B",
        pre_analysis=_analysis(policy=policy),
        post_root_info={"blackWinrate": 0.53, "visits": 100},
    )
    assert result["rawPolicy"] == pytest.approx(0.25)
    assert result["policyRank"] == 2


def test_visits_are_rank_fallback_when_order_is_unavailable():
    candidates = [
        {"move": "J8", "visits": 30, "blackWinrate": 0.57},
        {"move": "H8", "visits": 60, "blackWinrate": 0.64},
        {"move": "G8", "visits": 10, "blackWinrate": 0.53},
    ]
    result = evaluate_training_move(
        ply=5,
        user_move="J8",
        user_color="B",
        pre_analysis=_analysis(candidates=candidates),
        post_root_info={"blackWinrate": 0.55, "visits": 100},
    )
    assert result["recommendedMove"] == "H8"
    assert result["visitRank"] == 2
    assert result["visitRankSource"] == "visits"


def test_visit_rank_is_independent_from_engine_order_and_preserves_signed_difference():
    candidates = [
        {"move": "H8", "order": 0, "visits": 10, "blackWinrate": 0.60},
        {"move": "J8", "order": 1, "visits": 20, "blackWinrate": 0.62},
    ]
    result = evaluate_training_move(
        ply=5,
        user_move="J8",
        user_color="B",
        pre_analysis=_analysis(candidates=candidates),
        post_root_info={"blackWinrate": 0.61, "visits": 100},
    )

    assert result["recommendedMove"] == "H8"
    assert result["recommendedVisitRank"] == 2
    assert result["visitRank"] == 1
    assert result["searchOrder"] == 2
    assert result["visitRankDifference"] == -1
    assert result["visitRankGap"] == 0
    assert result["recommendedWinrateGap"] == pytest.approx(-0.02)
    assert result["winrateLoss"] == 0.0


def test_policy_rank_can_use_official_helper_legal_moves():
    policy = _policy(H8=0.40, J8=0.25, G8=0.90)
    candidates = [
        {"move": "H8", "order": 0, "visits": 60, "blackWinrate": 0.64},
        {"move": "J8", "order": 1, "visits": 40, "blackWinrate": 0.57},
    ]
    result = evaluate_training_move(
        ply=5,
        user_move="J8",
        user_color="B",
        pre_analysis=_analysis(policy=policy, candidates=candidates),
        post_root_info={"blackWinrate": 0.55, "visits": 100},
        legal_moves=["H8", "J8"],
    )

    assert result["policyRank"] == 2
    assert result["rawPolicyRank"] == 2
    assert result["policyRankBasis"] == "official-helper-legal-moves"


def test_official_legal_membership_precedes_negative_policy_handling():
    policy = _policy(H8=0.40, J8=-1.0)
    with pytest.raises(ValueError, match="absent from official legalMoves"):
        evaluate_training_move(
            ply=5,
            user_move="J8",
            user_color="B",
            pre_analysis=_analysis(policy=policy),
            post_root_info={"blackWinrate": 0.55, "visits": 100},
            legal_moves=["H8"],
        )


def test_duplicate_legal_moves_do_not_inflate_policy_rank():
    candidates = [
        {"move": "H8", "order": 0, "visits": 60, "blackWinrate": 0.64},
        {"move": "J8", "order": 1, "visits": 40, "blackWinrate": 0.57},
    ]
    result = evaluate_training_move(
        ply=5,
        user_move="J8",
        user_color="B",
        pre_analysis=_analysis(candidates=candidates),
        post_root_info={"blackWinrate": 0.55, "visits": 100},
        legal_moves=["H8", "H8", "J8"],
    )
    assert result["policyRank"] == 2


def test_candidates_must_match_official_helper_legality():
    with pytest.raises(ValueError, match="absent from official legalMoves: H8"):
        evaluate_training_move(
            ply=5,
            user_move="J8",
            user_color="B",
            pre_analysis=_analysis(),
            post_root_info={"blackWinrate": 0.55, "visits": 100},
            legal_moves=["J8", "G8"],
        )


@pytest.mark.parametrize(
    ("candidates", "message"),
    [
        ([{"move": "pass", "order": 0, "visits": 100}], "not pass"),
        (
            [
                {"move": "H8", "order": 0, "visits": 50},
                {"move": "H8", "order": 1, "visits": 50},
            ],
            "duplicate move H8",
        ),
    ],
)
def test_candidate_protocol_conflicts_are_rejected(candidates, message):
    with pytest.raises(ValueError, match=message):
        evaluate_training_move(
            ply=1,
            user_move="H8",
            user_color="B",
            pre_analysis=_analysis(candidates=candidates),
            post_root_info={"blackWinrate": 0.5, "visits": 100},
        )


def test_top_mistakes_prioritize_loss_then_rank_gap_then_policy():
    evaluations = [
        {
            "ply": 3,
            "winrateLoss": 0.03,
            "visitRankGap": 8,
            "policyRank": 9,
            "rawPolicy": 0.01,
            "isMistake": True,
            "analysisInsufficient": False,
        },
        {
            "ply": 5,
            "winrateLoss": 0.08,
            "visitRankGap": 1,
            "policyRank": 2,
            "rawPolicy": 0.2,
            "isMistake": True,
            "analysisInsufficient": False,
        },
        {
            "ply": 7,
            "winrateLoss": 0.08,
            "visitRankGap": 3,
            "policyRank": 4,
            "rawPolicy": 0.1,
            "isMistake": True,
            "analysisInsufficient": False,
        },
        {
            "ply": 9,
            "winrateLoss": 0.99,
            "visitRankGap": 99,
            "policyRank": 99,
            "rawPolicy": 0.0,
            "isMistake": None,
            "analysisInsufficient": True,
        },
        {
            "ply": 11,
            "winrateLoss": 0.0,
            "visitRankGap": 0,
            "policyRank": 1,
            "rawPolicy": 0.5,
            "isMistake": False,
            "analysisInsufficient": False,
        },
    ]

    result = summarize_top_mistakes(evaluations)
    assert [item["ply"] for item in result] == [7, 5, 3]


def test_mistake_sort_uses_lower_policy_after_equal_loss_and_visit_gap():
    evaluations = [
        {"ply": 1, "winrateLoss": 0.1, "visitRankGap": 2, "policyRank": 3,
         "rawPolicy": 0.2, "isMistake": True, "analysisInsufficient": False},
        {"ply": 2, "winrateLoss": 0.1, "visitRankGap": 2, "policyRank": 5,
         "rawPolicy": 0.1, "isMistake": True, "analysisInsufficient": False},
    ]
    assert [item["ply"] for item in summarize_top_mistakes(evaluations)] == [2, 1]


def test_supported_end_plies_default_validation_and_boundary():
    assert END_PLY_OPTIONS == (6, 8, 10, 12, 14, 16)
    assert select_end_ply() == DEFAULT_END_PLY == 14
    for end_ply in END_PLY_OPTIONS:
        assert select_end_ply(str(end_ply)) == end_ply
        assert has_reached_end_ply(end_ply - 1, end_ply) is False
        assert has_reached_end_ply(end_ply, end_ply) is True
        assert has_reached_end_ply(end_ply + 1, end_ply) is True

    with pytest.raises(ValueError, match="End ply must be one of"):
        select_end_ply(15)
    with pytest.raises(ValueError, match="Unsupported end ply"):
        select_end_ply("14.0")


def test_invalid_policy_length_and_user_color_are_rejected():
    with pytest.raises(ValueError, match="policy must contain 226"):
        evaluate_training_move(
            ply=1,
            user_move="H8",
            user_color="B",
            pre_analysis=_analysis(policy=[0.0] * 225),
            post_root_info={"blackWinrate": 0.5, "visits": 1},
        )
    with pytest.raises(ValueError, match="user_color must be B or W"):
        evaluate_training_move(
            ply=1,
            user_move="H8",
            user_color="X",
            pre_analysis=_analysis(),
            post_root_info={"blackWinrate": 0.5, "visits": 1},
        )


def test_nonfinite_policy_and_summary_metrics_are_rejected():
    policy = _policy(H8=0.4)
    policy[coordinate_to_policy_index("J8")] = float("nan")
    with pytest.raises(ValueError, match="finite numeric"):
        evaluate_training_move(
            ply=1,
            user_move="H8",
            user_color="B",
            pre_analysis=_analysis(policy=policy),
            post_root_info={"blackWinrate": 0.5, "visits": 100},
        )

    with pytest.raises(ValueError, match="must not contain NaN"):
        summarize_top_mistakes(
            [
                {
                    "ply": 1,
                    "winrateLoss": float("nan"),
                    "isMistake": True,
                    "analysisInsufficient": False,
                }
            ]
        )
