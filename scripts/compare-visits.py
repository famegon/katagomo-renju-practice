#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.config import PROJECT_ROOT, Settings
from server.engine import KataGomoEngine


async def run_analysis(
    engine: KataGomoEngine, visits: int
) -> tuple[list[dict], float]:
    queue: asyncio.Queue[dict] = asyncio.Queue()
    started = time.perf_counter()
    await engine.submit(
        moves=[("B", "H8"), ("W", "H9")],
        max_visits=visits,
        report_during_search_every=0.5,
        user_color="B",
        client_request_id=f"distribution-{visits}",
        output_queue=queue,
    )
    responses: list[dict] = []
    while True:
        response = await asyncio.wait_for(queue.get(), timeout=180.0)
        if response.get("type") != "analysis":
            continue
        responses.append(response)
        if response["isFinal"]:
            return responses, time.perf_counter() - started


def summarize(responses: list[dict], elapsed: float) -> dict:
    final = responses[-1]
    return {
        "elapsedSecondsIncludingRequest": elapsed,
        "partialResponses": sum(
            1 for response in responses if response["isDuringSearch"]
        ),
        "rootVisits": final["rootInfo"]["visits"],
        "candidateCount": len(final["candidates"]),
        "candidateVisitTotal": final["candidateVisitTotal"],
        "rawPolicyTop5": final["rawPolicyTop5"],
        "mctsByEngineOrderTop5": [
            {
                key: candidate[key]
                for key in (
                    "move",
                    "order",
                    "rawPrior",
                    "visits",
                    "visitShare",
                    "blackWinrate",
                )
            }
            for candidate in final["candidates"][:5]
        ],
        "mctsByVisitsTop5": [
            {
                key: candidate[key]
                for key in (
                    "move",
                    "order",
                    "rawPrior",
                    "visits",
                    "visitShare",
                    "blackWinrate",
                )
            }
            for candidate in sorted(
                final["candidates"], key=lambda candidate: candidate["visits"], reverse=True
            )[:5]
        ],
        "allCandidates": [
            {
                key: candidate[key]
                for key in (
                    "move",
                    "order",
                    "rawPrior",
                    "searchPrior",
                    "visits",
                    "visitShare",
                    "blackWinrate",
                )
            }
            for candidate in final["candidates"]
        ],
    }


async def main() -> None:
    output_directory = PROJECT_ROOT / "artifacts/stage2/candidate-distribution"
    output_directory.mkdir(parents=True, exist_ok=True)
    engine = KataGomoEngine(Settings.from_environment())
    await engine.start()
    comparison: dict[str, dict] = {}
    try:
        for visits in (100, 500):
            responses, elapsed = await run_analysis(engine, visits)
            response_path = output_directory / f"analysis-{visits}.jsonl"
            response_path.write_text(
                "".join(
                    json.dumps(response, separators=(",", ":")) + "\n"
                    for response in responses
                ),
                encoding="utf-8",
            )
            comparison[str(visits)] = summarize(responses, elapsed)
    finally:
        await engine.stop()
    summary_path = output_directory / "comparison.json"
    summary_path.write_text(
        json.dumps(comparison, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(summary_path)


if __name__ == "__main__":
    asyncio.run(main())
