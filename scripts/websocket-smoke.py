#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from websockets.asyncio.client import connect


async def main() -> None:
    output_path = Path("artifacts/stage3/websocket-response.jsonl")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    responses: list[dict] = []
    websocket_url = os.environ.get(
        "KATAGOMO_WEBSOCKET_URL",
        f"ws://127.0.0.1:{os.environ.get('KATAGOMO_PORT', '8000')}/ws/analysis",
    )
    async with connect(websocket_url) as websocket:
        responses.append(json.loads(await websocket.recv()))
        await websocket.send(
            json.dumps(
                {"action": "analyze", "moves": [["W", "H8"]]},
                separators=(",", ":"),
            )
        )
        validation_error = json.loads(await websocket.recv())
        responses.append(validation_error)
        if validation_error.get("code") != "validation_error":
            raise AssertionError(
                f"Expected JSON validation_error, got {validation_error}"
            )
        await websocket.send(
            json.dumps(
                {
                    "action": "analyze",
                    "moves": [["B", "H8"], ["W", "H9"]],
                    "rules": "renju",
                    "boardXSize": 15,
                    "boardYSize": 15,
                    # Use 500 here so the validated OpenCL backend cannot finish
                    # before the 0.5s during-search reporting interval.
                    "maxVisits": 500,
                    "reportDuringSearchEvery": 0.5,
                    "userColor": "B",
                    "clientRequestId": "websocket-real-smoke",
                    "analysisPurpose": "user_pre",
                    "positionRevision": 2,
                    "sessionEpoch": "websocket-smoke-session",
                },
                separators=(",", ":"),
            )
        )
        while True:
            response = json.loads(await asyncio.wait_for(websocket.recv(), timeout=30))
            responses.append(response)
            if response.get("type") == "analysis" and response.get("isFinal"):
                break

    output_path.write_text(
        "".join(json.dumps(response, separators=(",", ":")) + "\n" for response in responses),
        encoding="utf-8",
    )
    analysis = [response for response in responses if response.get("type") == "analysis"]
    partial_count = sum(1 for response in analysis if response["isDuringSearch"])
    final_count = sum(1 for response in analysis if response["isFinal"])
    if partial_count < 1:
        raise AssertionError("Expected at least one during-search WebSocket response")
    if final_count != 1:
        raise AssertionError(f"Expected one final WebSocket response, got {final_count}")
    final = analysis[-1]
    if final.get("policyLength") != 226 or len(final.get("policy", [])) != 226:
        raise AssertionError("Expected the complete 226-entry policy array")
    expected_identity = {
        "clientRequestId": "websocket-real-smoke",
        "analysisPurpose": "user_pre",
        "positionRevision": 2,
        "sessionEpoch": "websocket-smoke-session",
        "requestedMaxVisits": 500,
        "positionMoveCount": 2,
    }
    mismatched_identity = {
        field: final.get(field)
        for field, expected in expected_identity.items()
        if final.get(field) != expected
    }
    if mismatched_identity:
        raise AssertionError(
            f"Final response identity mismatch: {mismatched_identity}"
        )
    if not final.get("candidates"):
        raise AssertionError("Expected at least one real KataGomo candidate")
    top_candidate = final["candidates"][0]
    missing = [
        field
        for field in (
            "move",
            "order",
            "rawPrior",
            "visits",
            "visitShare",
            "blackWinrate",
            "pv",
            "pvVisits",
        )
        if field not in top_candidate
    ]
    if missing:
        raise AssertionError(f"Candidate is missing required fields: {missing}")
    if "rootInfo" not in final:
        raise AssertionError("Final response is missing rootInfo")
    print(
        json.dumps(
            {
                "output": str(output_path),
                "websocketUrl": websocket_url,
                "partialResponses": partial_count,
                "finalResponses": final_count,
                "policyLength": final["policyLength"],
                "candidateCount": len(final["candidates"]),
                "validationError": validation_error["code"],
                "identity": expected_identity,
                "topCandidate": top_candidate,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
