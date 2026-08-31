from __future__ import annotations

import asyncio
import json
import os

import pytest

from server.config import PROJECT_ROOT, Settings
from server.engine import KataGomoEngine
from server.legality import ForbiddenHelper
from server.training import evaluate_training_move


pytestmark = pytest.mark.integration


@pytest.mark.skipif(
    os.environ.get("KATAGOMO_RUN_INTEGRATION") != "1",
    reason="set KATAGOMO_RUN_INTEGRATION=1 to use the real engine and model",
)
@pytest.mark.asyncio
async def test_real_engine_streams_partial_and_final_renju_analysis():
    settings = Settings.from_environment()
    engine = KataGomoEngine(settings)
    queue = asyncio.Queue()
    responses: list[dict] = []
    post_responses: list[dict] = []
    await engine.start()
    try:
        request_id = await engine.submit(
            moves=[("B", "H8"), ("W", "H9")],
            max_visits=100,
            report_during_search_every=0.5,
            user_color="B",
            client_request_id="real-integration",
            output_queue=queue,
            analysis_purpose="user_pre",
            position_revision=2,
            session_epoch="real-integration-session",
        )
        while True:
            response = await asyncio.wait_for(queue.get(), timeout=90)
            if response.get("type") != "analysis":
                continue
            responses.append(response)
            if response["isFinal"]:
                break

        final = responses[-1]
        user_move = final["candidates"][0]["move"]
        legality = await ForbiddenHelper(settings.forbidden_helper_path).analyze(
            [("B", "H8"), ("W", "H9")], "B"
        )
        assert user_move in legality["legalMoves"]

        await engine.submit(
            moves=[("B", "H8"), ("W", "H9"), ("B", user_move)],
            max_visits=100,
            report_during_search_every=0.5,
            user_color="B",
            client_request_id="real-integration-post",
            output_queue=queue,
            analysis_purpose="final_grade",
            position_revision=3,
            session_epoch="real-integration-session",
        )
        while True:
            response = await asyncio.wait_for(queue.get(), timeout=90)
            if response.get("type") != "analysis":
                continue
            post_responses.append(response)
            if response["isFinal"]:
                break

        evaluation = evaluate_training_move(
            ply=3,
            user_move=user_move,
            user_color="B",
            pre_analysis=final,
            post_root_info=post_responses[-1]["rootInfo"],
            minimum_candidate_visits=50,
            legal_moves=legality["legalMoves"],
        )
    finally:
        await engine.stop()

    assert any(response["isDuringSearch"] for response in responses)
    finals = [response for response in responses if response["isFinal"]]
    assert len(finals) == 1
    final = finals[0]
    assert final["requestId"] == request_id
    assert final["policyLength"] == 226
    assert len(final["policy"]) == 226
    assert final["winratePerspective"] == "BLACK"
    assert final["candidates"]
    for field in ("rawPrior", "visits", "visitShare", "blackWinrate", "pv"):
        assert field in final["candidates"][0]
    assert "pvVisits" in final["candidates"][0]
    assert final["analysisPurpose"] == "user_pre"
    assert final["positionRevision"] == 2
    assert final["sessionEpoch"] == "real-integration-session"

    assert post_responses[-1]["isFinal"] is True
    assert post_responses[-1]["analysisPurpose"] == "final_grade"
    assert evaluation["userMove"] == final["candidates"][0]["move"]
    assert evaluation["recommendedMove"] == evaluation["userMove"]
    assert evaluation["rawPolicy"] >= 0
    assert evaluation["visitRank"] is not None
    assert evaluation["analysisInsufficient"] is False
    assert evaluation["isMistake"] is False

    output_path = PROJECT_ROOT / "artifacts/stage3/integration-training-response.jsonl"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "".join(
            json.dumps(response, separators=(",", ":")) + "\n"
            for response in [*responses, *post_responses, {"evaluation": evaluation}]
        ),
        encoding="utf-8",
    )
