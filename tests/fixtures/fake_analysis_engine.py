#!/usr/bin/env python3
from __future__ import annotations

import json
import sys


def emit(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":")), flush=True)


def analysis_response(request: dict, *, during: bool) -> dict:
    policy = [0.0] * 226
    policy[112] = 0.6
    policy[113] = 0.4
    return {
        "id": request["id"],
        "isDuringSearch": during,
        "moveInfos": [
            {
                "move": "H8",
                "order": 0,
                "prior": 0.55,
                "visits": 3,
                "winrate": 0.7,
                "pv": ["H8", "J8"],
                "pvVisits": [3, 2],
                "pvEdgeVisits": [3, 2],
            },
            {
                "move": "J8",
                "order": 1,
                "prior": 0.45,
                "visits": 1,
                "winrate": 0.6,
                "pv": ["J8"],
                "pvVisits": [1],
                "pvEdgeVisits": [1],
            },
        ],
        "policy": policy,
        "rootInfo": {
            "currentPlayer": "B",
            "visits": 4,
            "winrate": 0.68,
            "utility": 0.36,
        },
        "turnNumber": len(request.get("moves", [])),
    }


pending: dict[str, dict] = {}
for line in sys.stdin:
    request = json.loads(line)
    action = request.get("action")
    if action == "query_version":
        emit({"id": request["id"], "version": "fake-1"})
    elif action == "terminate":
        emit(request)
        terminated = pending.pop(request["terminateId"], None)
        if terminated is not None:
            emit(
                {
                    "id": terminated["id"],
                    "isDuringSearch": False,
                    "noResults": True,
                    "turnNumber": len(terminated.get("moves", [])),
                }
            )
    elif action == "terminate_all":
        emit(request)
        for terminated in pending.values():
            emit(
                {
                    "id": terminated["id"],
                    "isDuringSearch": False,
                    "noResults": True,
                    "turnNumber": len(terminated.get("moves", [])),
                }
            )
        pending.clear()
    else:
        if request.get("maxVisits") == 13:
            sys.exit(23)
        if request.get("maxVisits") == 6:
            pending[request["id"]] = request
            emit({"id": request["id"], "warning": "fake nonterminal warning"})
            continue
        if request.get("maxVisits") == 7:
            malformed = analysis_response(request, during=False)
            malformed["policy"] = []
            emit(malformed)
            continue
        if request.get("maxVisits") == 8:
            malformed = analysis_response(request, during=False)
            malformed["moveInfos"][0]["visits"] = "not-an-integer"
            emit(malformed)
            continue
        pending[request["id"]] = request
        emit(analysis_response(request, during=True))
        if request.get("maxVisits") == 42:
            emit(analysis_response(request, during=False))
            pending.pop(request["id"], None)
