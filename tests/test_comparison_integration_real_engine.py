from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import pytest

from server.analysis import winrate_for_player
from server.config import PROJECT_ROOT, Settings
from server.coordinates import coordinate_to_policy_index
from server.engine import KataGomoEngine
from server.legality import ForbiddenHelper


pytestmark = pytest.mark.integration


@pytest.mark.skipif(
    os.environ.get("KATAGOMO_RUN_INTEGRATION") != "1",
    reason="set KATAGOMO_RUN_INTEGRATION=1 to use the real engine and model",
)
@pytest.mark.asyncio
async def test_real_engine_compares_f9_and_h6_sequentially() -> None:
    settings = Settings.from_environment()
    engine = KataGomoEngine(settings)
    helper = ForbiddenHelper(settings.forbidden_helper_path)
    base_moves = [
        ("B", "H8"),
        ("W", "G7"),
        ("B", "G9"),
        ("W", "J7"),
    ]
    alternatives = {"a": "F9", "b": "H6"}
    comparison_epoch = "comparison:real-f9-vs-h6"
    base_revision = len(base_moves)
    max_visits = 100

    legality = await helper.analyze(base_moves, "B")
    assert legality["isTerminal"] is False
    assert legality["nextPlayer"] == "B"
    assert alternatives["a"] in legality["legalMoves"]
    assert alternatives["b"] in legality["legalMoves"]

    async def analyze(
        *,
        moves: list[tuple[str, str]],
        purpose: str,
        client_request_id: str,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        await engine.submit(
            moves=moves,
            max_visits=max_visits,
            report_during_search_every=0.5,
            user_color="B",
            client_request_id=client_request_id,
            output_queue=queue,
            analysis_purpose=purpose,
            position_revision=base_revision,
            session_epoch=comparison_epoch,
        )

        responses: list[dict[str, Any]] = []
        while True:
            response = await asyncio.wait_for(queue.get(), timeout=120)
            if response.get("type") == "error":
                raise AssertionError(
                    f"real comparison analysis failed: {response}"
                )
            if response.get("type") != "analysis":
                continue
            responses.append(response)
            if response.get("isFinal") is True:
                break

        partials = [
            response
            for response in responses
            if response.get("isDuringSearch") is True
        ]
        finals = [
            response for response in responses if response.get("isFinal") is True
        ]
        assert partials
        assert len(finals) == 1

        final = finals[0]
        expected_move_count = len(moves)
        for response in responses:
            assert response["clientRequestId"] == client_request_id
            assert response["analysisPurpose"] == purpose
            assert response["positionRevision"] == base_revision
            assert response["sessionEpoch"] == comparison_epoch
            assert response["requestedMaxVisits"] == max_visits
            assert response["positionMoveCount"] == expected_move_count
            assert response["turnNumber"] == expected_move_count
            assert response["policyLength"] == 226
            assert len(response["policy"]) == 226
            assert response["rootInfo"]
        assert final["candidates"]
        assert isinstance(final["candidates"][0]["pv"], list)
        assert final["candidates"][0]["pv"]
        return responses, final

    await engine.start()
    try:
        base_responses, base_final = await analyze(
            moves=base_moves,
            purpose="comparison_base",
            client_request_id="comparison-real-base",
        )
        a_moves = [*base_moves, ("B", alternatives["a"])]
        a_responses, a_final = await analyze(
            moves=a_moves,
            purpose="comparison_a",
            client_request_id="comparison-real-a",
        )
        b_moves = [*base_moves, ("B", alternatives["b"])]
        b_responses, b_final = await analyze(
            moves=b_moves,
            purpose="comparison_b",
            client_request_id="comparison-real-b",
        )
    finally:
        await engine.stop()

    assert engine.start_count == 1
    finals = [base_final, a_final, b_final]
    assert {final["requestedMaxVisits"] for final in finals} == {max_visits}
    assert [final["positionMoveCount"] for final in finals] == [4, 5, 5]
    assert [final["analysisPurpose"] for final in finals] == [
        "comparison_base",
        "comparison_a",
        "comparison_b",
    ]
    assert len({final["clientRequestId"] for final in finals}) == 3

    def base_candidate(move: str) -> dict[str, Any] | None:
        return next(
            (
                candidate
                for candidate in base_final["candidates"]
                if candidate["move"].upper() == move
            ),
            None,
        )

    def summarize_base_candidate(move: str) -> dict[str, Any]:
        candidate = base_candidate(move)
        if candidate is None:
            return {"present": False}
        return {
            "present": True,
            "order": candidate["order"],
            "visits": candidate["visits"],
            "visitShare": candidate["visitShare"],
            "blackWinrate": candidate["blackWinrate"],
            "pv": candidate["pv"],
        }

    def summarize_forced_result(
        final: dict[str, Any], responses: list[dict[str, Any]]
    ) -> dict[str, Any]:
        order_zero = next(
            candidate
            for candidate in final["candidates"]
            if candidate["order"] == 0
        )
        black_winrate = final["rootInfo"]["blackWinrate"]
        return {
            "postBlackWinrate": black_winrate,
            "mover": "B",
            "moverWinrate": winrate_for_player(black_winrate, "B"),
            "rootVisits": final["rootInfo"]["visits"],
            "partialResponseCount": sum(
                response["isDuringSearch"] for response in responses
            ),
            "opponentOrder0": {
                "move": order_zero["move"],
                "visits": order_zero["visits"],
                "visitShare": order_zero["visitShare"],
                "rawPrior": order_zero["rawPrior"],
                "blackWinrate": order_zero["blackWinrate"],
                "moverWinrate": winrate_for_player(
                    order_zero["blackWinrate"], "B"
                ),
                "pv": order_zero["pv"],
            },
        }

    report = {
        "scenario": "F9 versus H6 from B H8, W G7, B G9, W J7",
        "comparisonEpoch": comparison_epoch,
        "baseRevision": base_revision,
        "requestedMaxVisitsPerAnalysis": max_visits,
        "engineStartCount": engine.start_count,
        "officialLegality": {
            "source": legality["source"],
            "historySource": legality["historySource"],
            "nextPlayer": legality["nextPlayer"],
            "F9": alternatives["a"] in legality["legalMoves"],
            "H6": alternatives["b"] in legality["legalMoves"],
        },
        "base": {
            "partialResponseCount": sum(
                response["isDuringSearch"] for response in base_responses
            ),
            "rootVisits": base_final["rootInfo"]["visits"],
            "blackWinrate": base_final["rootInfo"]["blackWinrate"],
            "moverWinrate": base_final["rootInfo"]["userWinrate"],
            "rawPolicy": {
                move: base_final["policy"][coordinate_to_policy_index(move)]
                for move in alternatives.values()
            },
            "moveInfos": {
                move: summarize_base_candidate(move)
                for move in alternatives.values()
            },
        },
        "forced": {
            alternatives["a"]: summarize_forced_result(a_final, a_responses),
            alternatives["b"]: summarize_forced_result(b_final, b_responses),
        },
    }

    output_path = (
        PROJECT_ROOT
        / "artifacts/comparison-lab/integration-f9-vs-h6.json"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
