import json

from fastapi.testclient import TestClient

from server.app import create_app
from server.coordinates import coordinate_to_policy_index


def analysis_payload() -> dict:
    policy = [0.0] * 226
    policy[coordinate_to_policy_index("H8")] = 0.40
    policy[coordinate_to_policy_index("J8")] = 0.25
    policy[coordinate_to_policy_index("G8")] = 0.90
    return {
        "isFinal": True,
        "policy": policy,
        "candidates": [
            {
                "move": "H8",
                "order": 0,
                "visits": 60,
                "blackWinrate": 0.64,
            },
            {
                "move": "J8",
                "order": 1,
                "visits": 40,
                "blackWinrate": 0.57,
            },
        ],
        "candidateVisitTotal": 100,
        "rootInfo": {"blackWinrate": 0.60, "visits": 101},
        "analysisInsufficient": False,
    }


def terminal_state(*, winner: str | None = "B", move_count: int = 5) -> dict:
    outcome = "draw" if winner is None else ("black_win" if winner == "B" else "white_win")
    return {
        "boardXSize": 15,
        "boardYSize": 15,
        "rules": "renju",
        "isValid": True,
        "moveCount": move_count,
        "nextPlayer": "W" if move_count % 2 else "B",
        "isTerminal": True,
        "winner": winner,
        "outcome": outcome,
        "terminalReason": "board_full" if winner is None else "line_win",
        "terminalMove": "J8",
        "forbiddenMoves": [],
        "legalMoves": [],
        "source": "KataGomo Board::isForbidden()",
        "historySource": "KataGomo BoardHistory::makeBoardMoveAssumeLegal()",
    }


def test_training_options_contract(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        response = client.get("/api/training/options")
        assert response.status_code == 200
        assert response.json() == {
            "endPlyOptions": [6, 8, 10, 12, 14, 16],
            "defaultEndPly": 14,
            "manualFinishSupported": True,
            "manualEndValue": "manual",
            "minimumCandidateVisits": 50,
            "winratePerspective": "BLACK",
            "scoreContract": "metrics-only-no-opaque-score",
        }


def test_training_evaluate_uses_official_legal_moves_for_policy_rank(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        response = client.post(
            "/api/training/evaluate",
            json={
                "ply": 5,
                "userMove": "J8",
                "userColor": "B",
                "preAnalysis": analysis_payload(),
                "postRootInfo": {"blackWinrate": 0.55, "visits": 107},
                "legalMoves": ["H8", "J8"],
                "minimumCandidateVisits": 50,
                "clientEvaluationId": "eval-5",
                "sessionEpoch": "epoch-1",
                "prePositionRevision": 4,
                "postPositionRevision": 5,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["recommendedMove"] == "H8"
        assert body["rawPolicyRank"] == 2
        assert body["policyRankBasis"] == "official-helper-legal-moves"
        assert body["visitRank"] == 2
        assert body["recommendedWinrateGap"] > 0
        assert body["analysisInsufficient"] is False
        assert body["clientEvaluationId"] == "eval-5"
        assert body["sessionEpoch"] == "epoch-1"
        assert body["prePositionRevision"] == 4
        assert body["postPositionRevision"] == 5


def test_training_evaluate_uses_official_terminal_result_without_fake_search(
    fake_settings,
):
    with TestClient(create_app(fake_settings)) as client:
        response = client.post(
            "/api/training/evaluate",
            json={
                "ply": 5,
                "userMove": "J8",
                "userColor": "B",
                "preAnalysis": analysis_payload(),
                "terminalState": terminal_state(),
                "legalMoves": ["H8", "J8"],
                "minimumCandidateVisits": 50,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["afterUserWinrate"] == 1.0
        assert body["afterUserWinrateSource"] == "official-terminal-result"
        assert body["postRootVisits"] is None
        assert body["terminalOutcome"] == "black_win"
        assert body["terminalReason"] == "line_win"
        assert "zero-post-root-visits" not in body["analysisInsufficientReasons"]
        assert body["analysisInsufficient"] is False


def test_training_evaluate_requires_one_post_move_source(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        missing = client.post(
            "/api/training/evaluate",
            json={
                "ply": 5,
                "userMove": "J8",
                "userColor": "B",
                "preAnalysis": analysis_payload(),
            },
        )
        assert missing.status_code == 422

        duplicate = client.post(
            "/api/training/evaluate",
            json={
                "ply": 5,
                "userMove": "J8",
                "userColor": "B",
                "preAnalysis": analysis_payload(),
                "postRootInfo": {"blackWinrate": 0.55, "visits": 100},
                "terminalState": terminal_state(),
            },
        )
        assert duplicate.status_code == 422


def test_training_evaluate_rejects_move_missing_from_helper_legal_moves(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        response = client.post(
            "/api/training/evaluate",
            json={
                "ply": 5,
                "userMove": "J8",
                "userColor": "B",
                "preAnalysis": analysis_payload(),
                "postRootInfo": {"blackWinrate": 0.55, "visits": 107},
                "legalMoves": ["H8"],
            },
        )
        assert response.status_code == 422
        assert "absent from official legalMoves" in response.json()["detail"]


def test_training_evaluate_rejects_engine_candidate_outside_helper_legality(
    fake_settings,
):
    with TestClient(create_app(fake_settings)) as client:
        response = client.post(
            "/api/training/evaluate",
            json={
                "ply": 5,
                "userMove": "J8",
                "userColor": "B",
                "preAnalysis": analysis_payload(),
                "postRootInfo": {"blackWinrate": 0.55, "visits": 107},
                "legalMoves": ["J8"],
            },
        )
        assert response.status_code == 422
        assert "candidates contains moves absent" in response.json()["detail"]


def test_training_summary_excludes_insufficient_evaluations(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        response = client.post(
            "/api/training/summary",
            json={
                "evaluations": [
                    {
                        "ply": 3,
                        "winrateLoss": 0.03,
                        "visitRankGap": 2,
                        "policyRank": 4,
                        "rawPolicy": 0.1,
                        "isMistake": True,
                        "analysisInsufficient": False,
                    },
                    {
                        "ply": 5,
                        "winrateLoss": 0.90,
                        "visitRankGap": 20,
                        "policyRank": 40,
                        "rawPolicy": 0.0,
                        "isMistake": None,
                        "analysisInsufficient": True,
                    },
                ]
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["evaluationCount"] == 2
        assert body["insufficientCount"] == 1
        assert [entry["ply"] for entry in body["topMistakes"]] == [3]


def test_training_api_returns_422_for_nonfinite_metrics(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        pre_analysis = analysis_payload()
        pre_analysis["policy"][coordinate_to_policy_index("J8")] = float("nan")
        evaluation_payload = {
            "ply": 5,
            "userMove": "J8",
            "userColor": "B",
            "preAnalysis": pre_analysis,
            "postRootInfo": {"blackWinrate": 0.55, "visits": 107},
            "legalMoves": ["H8", "J8"],
        }
        evaluation = client.post(
            "/api/training/evaluate",
            content=json.dumps(evaluation_payload, allow_nan=True),
            headers={"Content-Type": "application/json"},
        )
        assert evaluation.status_code == 422
        assert "finite numeric" in evaluation.json()["detail"]

        summary_payload = {
            "evaluations": [
                {
                    "ply": 5,
                    "winrateLoss": float("nan"),
                    "isMistake": True,
                    "analysisInsufficient": False,
                }
            ]
        }
        summary = client.post(
            "/api/training/summary",
            content=json.dumps(summary_payload, allow_nan=True),
            headers={"Content-Type": "application/json"},
        )
        assert summary.status_code == 422
        assert "must not contain NaN" in summary.json()["detail"]

        overflow_analysis = analysis_payload()
        overflow_analysis["policy"][coordinate_to_policy_index("J8")] = 10**400
        overflow = client.post(
            "/api/training/evaluate",
            json={
                "ply": 5,
                "userMove": "J8",
                "userColor": "B",
                "preAnalysis": overflow_analysis,
                "postRootInfo": {"blackWinrate": 0.55, "visits": 107},
                "legalMoves": ["H8", "J8"],
            },
        )
        assert overflow.status_code == 422
        assert "policy must contain only numeric values" in overflow.json()["detail"]
