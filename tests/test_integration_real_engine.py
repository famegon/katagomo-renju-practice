from __future__ import annotations

import asyncio
import json
import os

import pytest

from server.config import PROJECT_ROOT, Settings
from server.engine import KataGomoEngine


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
    responses = []
    await engine.start()
    try:
        request_id = await engine.submit(
            moves=[("B", "H8"), ("W", "H9")],
            max_visits=100,
            report_during_search_every=0.5,
            user_color="B",
            client_request_id="real-integration",
            output_queue=queue,
        )
        while True:
            response = await asyncio.wait_for(queue.get(), timeout=90)
            if response.get("type") != "analysis":
                continue
            responses.append(response)
            if response["isFinal"]:
                break
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

    output_path = PROJECT_ROOT / "artifacts/stage2/integration-response.jsonl"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "".join(json.dumps(response, separators=(",", ":")) + "\n" for response in responses),
        encoding="utf-8",
    )

