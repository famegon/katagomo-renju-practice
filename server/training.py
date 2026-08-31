"""Pure helpers for evaluating an opening-training move.

The public functions in this module consume the transformed analysis contract
from :mod:`server.analysis`, but do not depend on FastAPI or an engine process.
All winrates supplied to :func:`evaluate_training_move` are BLACK-perspective
probabilities.  Returned before/after and comparison values are converted to
the selected user's perspective.

No opaque 0-100 score is produced.  ``mistakeSeverity`` exposes the measured
values used for ordering mistakes: recommendation winrate loss first, then
the MCTS visit/order rank gap, then the full-policy rank and raw policy.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from .coordinates import PASS_POLICY_INDEX, POLICY_LENGTH, coordinate_to_policy_index


END_PLY_OPTIONS = (6, 8, 10, 12, 14, 16)
DEFAULT_END_PLY = 14


def select_end_ply(value: int | str | None = None) -> int:
    """Return a supported training end ply, defaulting to 14.

    Strings are accepted because browser ``select`` values arrive as strings.
    Unsupported values are rejected instead of silently changing a session.
    """

    if value is None:
        return DEFAULT_END_PLY
    if isinstance(value, bool):
        raise ValueError(f"Unsupported end ply: {value!r}")
    try:
        selected = int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"Unsupported end ply: {value!r}") from exc
    if str(value).strip() != str(selected) and not isinstance(value, int):
        raise ValueError(f"Unsupported end ply: {value!r}")
    if selected not in END_PLY_OPTIONS:
        raise ValueError(
            f"End ply must be one of {END_PLY_OPTIONS}, got {selected}"
        )
    return selected


def has_reached_end_ply(current_ply: int, end_ply: int | str | None = None) -> bool:
    """Return whether a training line has reached its selected stopping ply."""

    if isinstance(current_ply, bool) or not isinstance(current_ply, int):
        raise ValueError(f"current_ply must be a non-negative integer: {current_ply!r}")
    if current_ply < 0:
        raise ValueError(f"current_ply must be non-negative: {current_ply}")
    return current_ply >= select_end_ply(end_ply)


def _player(value: str) -> str:
    normalized = value.upper()
    if normalized not in {"B", "W"}:
        raise ValueError(f"user_color must be B or W, got {value!r}")
    return normalized


def _probability(value: Any, *, field: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{field} must be a probability, got {value!r}") from exc
    if not math.isfinite(result) or not 0.0 <= result <= 1.0:
        raise ValueError(f"{field} must be between 0 and 1, got {result}")
    return result


def _user_winrate(black_winrate: Any, user_color: str, *, field: str) -> float:
    black = _probability(black_winrate, field=field)
    return black if user_color == "B" else 1.0 - black


def _non_negative_int(value: Any, *, field: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a non-negative integer, got {value!r}")
    try:
        result = int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(
            f"{field} must be a non-negative integer, got {value!r}"
        ) from exc
    if result < 0:
        raise ValueError(f"{field} must be non-negative, got {result}")
    return result


def _policy_value_and_rank(
    policy: Sequence[Any],
    move: str,
    legal_moves: Sequence[str] | None,
) -> tuple[float, int | None, str]:
    if len(policy) != POLICY_LENGTH:
        raise ValueError(f"policy must contain {POLICY_LENGTH} values, got {len(policy)}")
    index = coordinate_to_policy_index(move)
    if index == PASS_POLICY_INDEX:
        raise ValueError("A training move must be a board coordinate, not pass")
    try:
        values = [float(value) for value in policy]
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("policy must contain only numeric values") from exc
    if not all(math.isfinite(value) for value in values):
        raise ValueError("policy must contain only finite numeric values")
    raw_policy = values[index]
    if legal_moves is None:
        ranked_values = [
            value for value in values[:PASS_POLICY_INDEX] if value >= 0.0
        ]
        rank_basis = "nonnegative-policy-board-points"
    else:
        legal_indices: list[int] = []
        seen_indices: set[int] = set()
        for legal_move in legal_moves:
            legal_index = coordinate_to_policy_index(str(legal_move).strip().upper())
            if legal_index == PASS_POLICY_INDEX:
                continue
            if legal_index in seen_indices:
                continue
            seen_indices.add(legal_index)
            legal_indices.append(legal_index)
        if index not in legal_indices:
            raise ValueError(f"user move {move!r} is absent from official legalMoves")
        ranked_values = [values[legal_index] for legal_index in legal_indices]
        rank_basis = "official-helper-legal-moves"
    # KataGomo uses negative policy values for unavailable points. Do not turn
    # that convention into a legality decision; official legalMoves above owns
    # legality. Preserve the protocol conflict as unavailable analysis data.
    if raw_policy < 0.0:
        return raw_policy, None, "negative-policy-unavailable"
    # Competition ranking is stable under ties: equal policy values share rank.
    rank = 1 + sum(value > raw_policy for value in ranked_values)
    return raw_policy, rank, rank_basis


def _normalized_legal_moves(legal_moves: Sequence[str] | None) -> list[str] | None:
    if legal_moves is None:
        return None
    normalized: list[str] = []
    seen: set[str] = set()
    for legal_move in legal_moves:
        move = str(legal_move).strip().upper()
        index = coordinate_to_policy_index(move)
        if index == PASS_POLICY_INDEX or move in seen:
            continue
        seen.add(move)
        normalized.append(move)
    return normalized


def _candidate_order(candidate: Mapping[str, Any]) -> int | None:
    value = candidate.get("order")
    if value is None or isinstance(value, bool):
        return None
    try:
        order = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return order if order >= 0 else None


def _candidate_visits(candidate: Mapping[str, Any]) -> int:
    return _non_negative_int(candidate.get("visits", 0), field="candidate visits")


def _ordered_candidates(
    candidates: Sequence[Mapping[str, Any]],
) -> list[tuple[Mapping[str, Any], int, str]]:
    prepared: list[tuple[Mapping[str, Any], int, str, int, int | None]] = []
    seen_moves: set[str] = set()
    for index, candidate in enumerate(candidates):
        move = str(candidate.get("move", "")).strip().upper()
        policy_index = coordinate_to_policy_index(move)
        if policy_index == PASS_POLICY_INDEX:
            raise ValueError("Training candidates must be board coordinates, not pass")
        if move in seen_moves:
            raise ValueError(f"pre_analysis.candidates contains duplicate move {move}")
        seen_moves.add(move)
        visits = _candidate_visits(candidate)
        prepared.append((candidate, visits, move, index, _candidate_order(candidate)))

    if prepared and all(item[4] is not None for item in prepared):
        prepared.sort(key=lambda item: (item[4], -item[1], item[3]))
    else:
        # Some backends may omit ``order``.  Visits provide the explicit
        # fallback rather than relying on incoming array order.
        prepared.sort(key=lambda item: (-item[1], item[3]))
    return [(candidate, visits, move) for candidate, visits, move, _, _ in prepared]


def _visit_rank(
    candidates: Sequence[tuple[Mapping[str, Any], int, str]], move: str
) -> int | None:
    chosen = next((visits for _, visits, name in candidates if name == move), None)
    if chosen is None:
        return None
    # Competition ranking: candidates tied on visits share the same rank.
    return 1 + sum(visits > chosen for _, visits, _ in candidates)


def evaluate_training_move(
    *,
    ply: int,
    user_move: str,
    user_color: str,
    pre_analysis: Mapping[str, Any],
    post_root_info: Mapping[str, Any],
    minimum_candidate_visits: int = 1,
    legal_moves: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Evaluate one user move using pre-move analysis and its post-move root.

    ``pre_analysis`` must contain the transformed ``policy`` (226 values),
    ``candidates``, and ``rootInfo`` objects.  Candidate and root winrates use
    the explicit ``blackWinrate`` field.  ``post_root_info`` is the rootInfo
    object obtained after playing ``user_move`` and analyzing the new root.

    Recommendation loss uses same-search candidate winrates when the user's
    move is present in ``candidates``.  If MCTS omitted the move, the post-move
    root winrate is the transparent fallback and ``winrateLossSource`` records
    that fact.  The separate ``winrateDelta`` always means post minus pre from
    the user's perspective.
    """

    if isinstance(ply, bool) or not isinstance(ply, int) or ply <= 0:
        raise ValueError(f"ply must be a positive integer, got {ply!r}")
    color = _player(user_color)
    expected_color = "B" if ply % 2 == 1 else "W"
    if color != expected_color:
        raise ValueError(
            f"ply {ply} must be a {expected_color} user move, got {color}"
        )
    normalized_move = user_move.strip().upper()
    policy = pre_analysis.get("policy")
    if not isinstance(policy, Sequence) or isinstance(policy, (str, bytes)):
        raise ValueError("pre_analysis.policy must be a 226-value sequence")
    normalized_legal_moves = _normalized_legal_moves(legal_moves)
    raw_policy, policy_rank, policy_rank_basis = _policy_value_and_rank(
        policy, normalized_move, normalized_legal_moves
    )

    raw_candidates = pre_analysis.get("candidates", [])
    if not isinstance(raw_candidates, Sequence) or isinstance(
        raw_candidates, (str, bytes)
    ):
        raise ValueError("pre_analysis.candidates must be a sequence")
    if not all(isinstance(item, Mapping) for item in raw_candidates):
        raise ValueError("pre_analysis.candidates must contain objects")
    ordered = _ordered_candidates(raw_candidates)
    if normalized_legal_moves is not None:
        official_legal_set = set(normalized_legal_moves)
        illegal_candidates = [move for _, _, move in ordered if move not in official_legal_set]
        if illegal_candidates:
            raise ValueError(
                "pre_analysis.candidates contains moves absent from official legalMoves: "
                + ", ".join(illegal_candidates)
            )
    candidate_visit_total = sum(item[1] for item in ordered)

    configured_minimum = _non_negative_int(
        minimum_candidate_visits, field="minimum_candidate_visits"
    )
    engine_insufficient = bool(pre_analysis.get("analysisInsufficient", False))
    insufficient_reasons: list[str] = []
    if policy_rank is None:
        insufficient_reasons.append("user-move-policy-unavailable")
    if candidate_visit_total == 0:
        insufficient_reasons.append("zero-candidate-visits")
    elif candidate_visit_total < configured_minimum:
        insufficient_reasons.append("below-minimum-candidate-visits")
    if engine_insufficient:
        insufficient_reasons.append("engine-marked-insufficient")
    if pre_analysis.get("isFinal") is not True:
        insufficient_reasons.append("pre-analysis-not-final")

    pre_root = pre_analysis.get("rootInfo")
    if not isinstance(pre_root, Mapping):
        raise ValueError("pre_analysis.rootInfo must be an object")
    for field, current_player in (
        ("pre_analysis.currentPlayer", pre_analysis.get("currentPlayer")),
        ("pre_analysis.rootInfo.currentPlayer", pre_root.get("currentPlayer")),
    ):
        if current_player is not None and str(current_player).upper() != color:
            raise ValueError(f"{field} must be {color} for ply {ply}")
    turn_number = pre_analysis.get("turnNumber")
    if turn_number is not None and _non_negative_int(
        turn_number, field="pre_analysis.turnNumber"
    ) != ply - 1:
        raise ValueError(f"pre_analysis.turnNumber must be {ply - 1} for ply {ply}")
    post_current_player = post_root_info.get("currentPlayer")
    expected_post_player = "W" if color == "B" else "B"
    if post_current_player is not None and str(post_current_player).upper() != expected_post_player:
        raise ValueError(
            f"post_root_info.currentPlayer must be {expected_post_player} after {color}"
        )
    before_user_winrate = _user_winrate(
        pre_root.get("blackWinrate"), color, field="pre root blackWinrate"
    )
    after_user_winrate = _user_winrate(
        post_root_info.get("blackWinrate"), color, field="post root blackWinrate"
    )
    winrate_delta = after_user_winrate - before_user_winrate

    pre_root_visits = _non_negative_int(pre_root.get("visits", 0), field="pre root visits")
    post_root_visits = _non_negative_int(
        post_root_info.get("visits", 0), field="post root visits"
    )
    if post_root_visits == 0:
        insufficient_reasons.append("zero-post-root-visits")
    elif post_root_visits < configured_minimum:
        insufficient_reasons.append("below-minimum-post-root-visits")
    if pre_root_visits == 0:
        insufficient_reasons.append("zero-pre-root-visits")
    elif pre_root_visits < configured_minimum:
        insufficient_reasons.append("below-minimum-pre-root-visits")

    recommended_move: str | None = None
    recommended_visits: int | None = None
    recommended_user_winrate: float | None = None
    recommended_visit_rank: int | None = None
    if ordered:
        recommended, recommended_visits, recommended_move = ordered[0]
        recommended_visit_rank = _visit_rank(ordered, recommended_move)
        recommended_user_winrate = _user_winrate(
            recommended.get("blackWinrate"),
            color,
            field="recommended candidate blackWinrate",
        )

    chosen_candidate: Mapping[str, Any] | None = None
    chosen_visits: int | None = None
    visit_rank: int | None = None
    search_order: int | None = None
    chosen_expected_user_winrate: float | None = None
    for candidate, visits, move in ordered:
        if move == normalized_move:
            chosen_candidate = candidate
            chosen_visits = visits
            visit_rank = _visit_rank(ordered, normalized_move)
            order = _candidate_order(candidate)
            search_order = order + 1 if order is not None else None
            chosen_expected_user_winrate = _user_winrate(
                candidate.get("blackWinrate"),
                color,
                field="chosen candidate blackWinrate",
            )
            break

    if chosen_candidate is None:
        insufficient_reasons.append("chosen-move-not-in-candidates")
    analysis_insufficient = bool(insufficient_reasons)

    visit_rank_difference = (
        visit_rank - recommended_visit_rank
        if visit_rank is not None and recommended_visit_rank is not None
        else None
    )
    visit_rank_gap = (
        max(0, visit_rank_difference)
        if visit_rank_difference is not None
        else None
    )
    comparison_user_winrate = (
        chosen_expected_user_winrate
        if chosen_expected_user_winrate is not None
        else after_user_winrate
    )
    winrate_loss_source = (
        "pre-move-candidates"
        if chosen_expected_user_winrate is not None
        else "post-move-root"
    )
    recommended_winrate_gap = (
        recommended_user_winrate - comparison_user_winrate
        if recommended_user_winrate is not None
        else 0.0
    )
    winrate_loss = max(0.0, recommended_winrate_gap)

    is_mistake: bool | None
    if analysis_insufficient or recommended_move is None:
        is_mistake = None
    else:
        is_mistake = normalized_move != recommended_move

    return {
        "ply": ply,
        "userMove": normalized_move,
        "userColor": color,
        "recommendedMove": recommended_move,
        "rawPolicy": raw_policy,
        "policyRank": policy_rank,
        "rawPolicyRank": policy_rank,
        "policyRankBasis": policy_rank_basis,
        "visitRank": visit_rank,
        "visitRankSource": "visits" if visit_rank is not None else None,
        "searchOrder": search_order,
        "recommendedVisitRank": recommended_visit_rank,
        "visitRankDifference": visit_rank_difference,
        "visitRankGap": visit_rank_gap,
        "candidateVisits": chosen_visits,
        "candidateVisitTotal": candidate_visit_total,
        "recommendedVisits": recommended_visits,
        "preRootVisits": pre_root_visits,
        "postRootVisits": post_root_visits,
        "beforeUserWinrate": before_user_winrate,
        "afterUserWinrate": after_user_winrate,
        "winrateDelta": winrate_delta,
        "recommendedUserWinrate": recommended_user_winrate,
        "chosenExpectedUserWinrate": chosen_expected_user_winrate,
        "recommendedWinrateGap": recommended_winrate_gap,
        "winrateLoss": winrate_loss,
        "winrateLossSource": winrate_loss_source,
        "analysisInsufficient": analysis_insufficient,
        "analysisInsufficientReasons": insufficient_reasons,
        "minimumCandidateVisits": configured_minimum,
        "isMistake": is_mistake,
        "mistakeSeverity": {
            "winrateLoss": winrate_loss,
            "visitRankGap": visit_rank_gap,
            "policyRank": policy_rank,
            "rawPolicy": raw_policy,
        },
    }


def _mistake_sort_key(evaluation: Mapping[str, Any]) -> tuple[float, int, int, float]:
    loss = float(evaluation.get("winrateLoss", 0.0))
    visit_gap = evaluation.get("visitRankGap")
    policy_rank = evaluation.get("policyRank")
    raw_policy = evaluation.get("rawPolicy")
    if not math.isfinite(loss):
        raise ValueError("winrateLoss must be finite")
    if raw_policy is not None and not math.isfinite(float(raw_policy)):
        raise ValueError("rawPolicy must be finite")
    return (
        loss,
        int(visit_gap) if visit_gap is not None else -1,
        int(policy_rank) if policy_rank is not None else -1,
        -float(raw_policy) if raw_policy is not None else float("-inf"),
    )


def _validate_json_finite(value: Any, *, path: str = "evaluation") -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{path} must not contain NaN or infinity")
    if isinstance(value, Mapping):
        for key, nested in value.items():
            _validate_json_finite(nested, path=f"{path}.{key}")
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for index, nested in enumerate(value):
            _validate_json_finite(nested, path=f"{path}[{index}]")


def summarize_top_mistakes(
    evaluations: Sequence[Mapping[str, Any]], *, limit: int = 3
) -> list[Mapping[str, Any]]:
    """Return the strongest sufficiently-analyzed non-recommended moves.

    Ordering is lexicographic, not an invented score: larger winrate loss,
    then larger visit-rank gap, then worse policy rank, then lower raw policy.
    Insufficient analyses are intentionally excluded from confident summaries.
    """

    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0:
        raise ValueError(f"limit must be a non-negative integer, got {limit!r}")
    eligible = [
        evaluation
        for evaluation in evaluations
        if not bool(evaluation.get("analysisInsufficient", False))
        and evaluation.get("isMistake") is True
    ]
    for evaluation in eligible:
        _validate_json_finite(evaluation)
    return sorted(eligible, key=_mistake_sort_key, reverse=True)[:limit]
