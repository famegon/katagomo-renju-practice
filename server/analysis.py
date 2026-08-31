from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from .coordinates import (
    PASS_POLICY_INDEX,
    coordinate_to_policy_index,
    normalize_coordinate,
    policy_index_to_coordinate,
)


class AnalysisProtocolError(ValueError):
    """Raised when KataGomo violates the requested analysis response contract."""


def _finite_float(value: Any, *, field: str) -> float:
    if isinstance(value, bool):
        raise AnalysisProtocolError(f"KataGomo {field} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise AnalysisProtocolError(
            f"KataGomo {field} must be a finite number"
        ) from exc
    if not math.isfinite(number):
        raise AnalysisProtocolError(f"KataGomo {field} must be a finite number")
    return number


def _probability(value: Any, *, field: str) -> float:
    number = _finite_float(value, field=field)
    if not 0.0 <= number <= 1.0:
        raise AnalysisProtocolError(f"KataGomo {field} must be between 0 and 1")
    return number


def _non_negative_integer(value: Any, *, field: str) -> int:
    if isinstance(value, bool):
        raise AnalysisProtocolError(
            f"KataGomo {field} must be a non-negative integer"
        )
    try:
        number = int(value)
        numeric_value = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise AnalysisProtocolError(
            f"KataGomo {field} must be a non-negative integer"
        ) from exc
    if not math.isfinite(numeric_value) or numeric_value != number or number < 0:
        raise AnalysisProtocolError(
            f"KataGomo {field} must be a non-negative integer"
        )
    return number


def _validate_finite_json_numbers(value: Any, *, field: str) -> None:
    """Reject the NaN/Infinity extensions accepted by Python's JSON decoder."""

    if isinstance(value, float):
        if not math.isfinite(value):
            raise AnalysisProtocolError(
                f"KataGomo {field} contains a non-finite number"
            )
        return
    if isinstance(value, Mapping):
        for key, nested in value.items():
            _validate_finite_json_numbers(nested, field=f"{field}.{key}")
        return
    if isinstance(value, list):
        for index, nested in enumerate(value):
            _validate_finite_json_numbers(nested, field=f"{field}[{index}]")


def _coordinate_list(value: Any, *, field: str) -> list[str]:
    if not isinstance(value, list):
        raise AnalysisProtocolError(f"KataGomo {field} must be an array")
    coordinates: list[str] = []
    for index, coordinate in enumerate(value):
        if not isinstance(coordinate, str):
            raise AnalysisProtocolError(
                f"KataGomo {field}[{index}] must be a valid coordinate"
            )
        try:
            normalize_coordinate(coordinate)
        except ValueError as exc:
            raise AnalysisProtocolError(
                f"KataGomo {field}[{index}] must be a valid coordinate"
            ) from exc
        coordinates.append(coordinate)
    return coordinates


def _non_negative_integer_list(value: Any, *, field: str) -> list[int]:
    if not isinstance(value, list):
        raise AnalysisProtocolError(f"KataGomo {field} must be an array")
    return [
        _non_negative_integer(item, field=f"{field}[{index}]")
        for index, item in enumerate(value)
    ]


def winrate_for_player(black_winrate: float, player: str) -> float:
    normalized = player.upper()
    if normalized == "B":
        return black_winrate
    if normalized == "W":
        return 1.0 - black_winrate
    raise ValueError(f"Player must be B or W, got {player!r}")


def calculate_visit_shares(move_infos: list[dict[str, Any]]) -> tuple[list[float], int]:
    visits: list[int] = []
    for index, move in enumerate(move_infos):
        if not isinstance(move, Mapping):
            raise AnalysisProtocolError(
                f"KataGomo moveInfos[{index}] must be an object"
            )
        visits.append(
            _non_negative_integer(
                move.get("visits"), field=f"moveInfos[{index}].visits"
            )
        )
    total = sum(visits)
    if total == 0:
        return [0.0 for _ in visits], 0
    return [value / total for value in visits], total


def raw_policy_top(policy: list[float], limit: int = 5) -> list[dict[str, Any]]:
    available = [
        (index, value)
        for index, value in enumerate(policy[:PASS_POLICY_INDEX])
        if value >= 0.0
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
    if not isinstance(raw, Mapping):
        raise AnalysisProtocolError("KataGomo analysis response must be an object")
    _validate_finite_json_numbers(raw, field="analysis response")

    no_results = raw.get("noResults")
    if no_results is not None and not isinstance(no_results, bool):
        raise AnalysisProtocolError("KataGomo noResults must be a boolean")
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

    is_during_search_value = raw.get("isDuringSearch")
    if not isinstance(is_during_search_value, bool):
        raise AnalysisProtocolError("KataGomo isDuringSearch must be a boolean")
    is_during_search = is_during_search_value

    raw_root_value = raw.get("rootInfo")
    if not isinstance(raw_root_value, Mapping):
        raise AnalysisProtocolError("KataGomo rootInfo must be an object")
    raw_root = dict(raw_root_value)
    current_player_value = raw_root.get("currentPlayer")
    if not isinstance(current_player_value, str):
        raise AnalysisProtocolError("KataGomo rootInfo.currentPlayer must be B or W")
    current_player = current_player_value.upper()
    if current_player not in {"B", "W"}:
        raise AnalysisProtocolError("KataGomo rootInfo.currentPlayer must be B or W")
    root_black_winrate = _probability(
        raw_root.get("winrate"), field="rootInfo.winrate"
    )
    root_info = {key: value for key, value in raw_root.items() if key != "winrate"}
    root_info["visits"] = _non_negative_integer(
        root_info.get("visits"), field="rootInfo.visits"
    )
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

    raw_policy = raw.get("policy")
    if raw_policy is None:
        policy: list[float] = []
    elif not isinstance(raw_policy, list):
        raise AnalysisProtocolError("KataGomo policy must be a numeric array")
    else:
        policy = [
            _finite_float(value, field=f"policy[{index}]")
            for index, value in enumerate(raw_policy)
        ]
    expected_policy_length = PASS_POLICY_INDEX + 1
    if len(policy) != expected_policy_length:
        raise AnalysisProtocolError(
            "KataGomo policy length must be "
            f"{expected_policy_length}, got {len(policy)}"
        )
    raw_moves_value = raw.get("moveInfos")
    if not isinstance(raw_moves_value, list):
        raise AnalysisProtocolError("KataGomo moveInfos must be an array")
    raw_moves: list[dict[str, Any]] = raw_moves_value
    shares, candidate_visit_total = calculate_visit_shares(raw_moves)
    candidates: list[dict[str, Any]] = []
    for index, (move, visit_share) in enumerate(
        zip(raw_moves, shares, strict=True)
    ):
        if not isinstance(move, Mapping):
            raise AnalysisProtocolError(
                f"KataGomo moveInfos[{index}] must be an object"
            )
        black_winrate = _probability(
            move.get("winrate"),
            field=f"moveInfos[{index}].winrate",
        )
        candidate = {
            key: value
            for key, value in move.items()
            if key not in {"prior", "winrate"}
        }
        move_name_value = move.get("move")
        if not isinstance(move_name_value, str):
            raise AnalysisProtocolError(
                f"KataGomo moveInfos[{index}].move must be a valid coordinate"
            )
        move_name = move_name_value
        try:
            policy_index = coordinate_to_policy_index(move_name)
            raw_prior = policy[policy_index]
        except (ValueError, IndexError) as exc:
            raise AnalysisProtocolError(
                f"KataGomo returned an invalid candidate coordinate: {move_name!r}"
            ) from exc
        candidate.update(
            {
                "order": _non_negative_integer(
                    move.get("order"), field=f"moveInfos[{index}].order"
                ),
                "pv": _coordinate_list(
                    move.get("pv"), field=f"moveInfos[{index}].pv"
                ),
                "pvVisits": _non_negative_integer_list(
                    move.get("pvVisits"), field=f"moveInfos[{index}].pvVisits"
                ),
                "pvEdgeVisits": _non_negative_integer_list(
                    move.get("pvEdgeVisits"),
                    field=f"moveInfos[{index}].pvEdgeVisits",
                ),
                "rawPrior": raw_prior,
                "searchPrior": _finite_float(
                    move.get("prior"),
                    field=f"moveInfos[{index}].prior",
                ),
                "visits": _non_negative_integer(
                    move.get("visits"),
                    field=f"moveInfos[{index}].visits",
                ),
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
