from __future__ import annotations

from typing import Any

from .coordinates import (
    PASS_POLICY_INDEX,
    coordinate_to_policy_index,
    policy_index_to_coordinate,
)


class AnalysisProtocolError(ValueError):
    """Raised when KataGomo violates the requested analysis response contract."""


def winrate_for_player(black_winrate: float, player: str) -> float:
    normalized = player.upper()
    if normalized == "B":
        return black_winrate
    if normalized == "W":
        return 1.0 - black_winrate
    raise ValueError(f"Player must be B or W, got {player!r}")


def calculate_visit_shares(move_infos: list[dict[str, Any]]) -> tuple[list[float], int]:
    visits = [max(0, int(move.get("visits", 0))) for move in move_infos]
    total = sum(visits)
    if total == 0:
        return [0.0 for _ in visits], 0
    return [value / total for value in visits], total


def raw_policy_top(policy: list[float], limit: int = 5) -> list[dict[str, Any]]:
    available = [
        (index, float(value))
        for index, value in enumerate(policy[:PASS_POLICY_INDEX])
        if float(value) >= 0.0
    ]
    available.sort(key=lambda item: item[1], reverse=True)
    return [
        {"move": policy_index_to_coordinate(index), "rawPolicy": value}
        for index, value in available[:limit]
    ]


def transform_analysis_response(
    raw: dict[str, Any],
    *,
    request_id: str,
    user_color: str,
) -> dict[str, Any]:
    is_during_search = bool(raw.get("isDuringSearch", False))
    if raw.get("noResults") is True:
        return {
            "type": "analysis",
            "requestId": request_id,
            "turnNumber": raw.get("turnNumber"),
            "isDuringSearch": False,
            "isFinal": True,
            "analysisState": "canceled",
            "analysisInsufficient": True,
            "noResults": True,
        }

    raw_root = dict(raw.get("rootInfo") or {})
    current_player = str(raw_root.get("currentPlayer", "B")).upper()
    root_black_winrate = float(raw_root.get("winrate", 0.5))
    root_info = {key: value for key, value in raw_root.items() if key != "winrate"}
    root_info.update(
        {
            "blackWinrate": root_black_winrate,
            "currentPlayerWinrate": winrate_for_player(
                root_black_winrate, current_player
            ),
            "userWinrate": winrate_for_player(root_black_winrate, user_color),
            "winratePerspective": "BLACK",
        }
    )

    try:
        policy = [float(value) for value in raw.get("policy") or []]
    except (TypeError, ValueError) as exc:
        raise AnalysisProtocolError("KataGomo policy must be a numeric array") from exc
    expected_policy_length = PASS_POLICY_INDEX + 1
    if len(policy) != expected_policy_length:
        raise AnalysisProtocolError(
            "KataGomo policy length must be "
            f"{expected_policy_length}, got {len(policy)}"
        )
    raw_moves = list(raw.get("moveInfos") or [])
    shares, candidate_visit_total = calculate_visit_shares(raw_moves)
    candidates: list[dict[str, Any]] = []
    for move, visit_share in zip(raw_moves, shares, strict=True):
        black_winrate = float(move.get("winrate", root_black_winrate))
        candidate = {
            key: value
            for key, value in move.items()
            if key not in {"prior", "winrate"}
        }
        move_name = str(move.get("move", ""))
        try:
            policy_index = coordinate_to_policy_index(move_name)
            raw_prior = policy[policy_index]
        except (ValueError, IndexError) as exc:
            raise AnalysisProtocolError(
                f"KataGomo returned an invalid candidate coordinate: {move_name!r}"
            ) from exc
        candidate.update(
            {
                "rawPrior": raw_prior,
                "searchPrior": float(move.get("prior", 0.0)),
                "visits": max(0, int(move.get("visits", 0))),
                "visitShare": visit_share,
                "blackWinrate": black_winrate,
                "currentPlayerWinrate": winrate_for_player(
                    black_winrate, current_player
                ),
                "userWinrate": winrate_for_player(black_winrate, user_color),
                "winratePerspective": "BLACK",
            }
        )
        candidates.append(candidate)

    insufficient = candidate_visit_total == 0
    if insufficient:
        analysis_state = "insufficient"
    elif is_during_search:
        analysis_state = "searching"
    else:
        analysis_state = "complete"

    return {
        "type": "analysis",
        "requestId": request_id,
        "engineRequestId": raw.get("id"),
        "turnNumber": raw.get("turnNumber"),
        "isDuringSearch": is_during_search,
        "isFinal": not is_during_search,
        "analysisState": analysis_state,
        "analysisInsufficient": insufficient,
        "winratePerspective": "BLACK",
        "currentPlayer": current_player,
        "userColor": user_color,
        "candidateVisitTotal": candidate_visit_total,
        "candidates": candidates,
        "rootInfo": root_info,
        "policy": policy,
        "policyLength": len(policy),
        "rawPolicyTop5": raw_policy_top(policy, 5) if policy else [],
    }
