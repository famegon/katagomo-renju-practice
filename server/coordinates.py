from __future__ import annotations

import re


BOARD_SIZE = 15
COLUMNS = "ABCDEFGHJKLMNOP"
POLICY_LENGTH = BOARD_SIZE * BOARD_SIZE + 1
PASS_POLICY_INDEX = BOARD_SIZE * BOARD_SIZE
_COORDINATE_RE = re.compile(r"^([A-HJ-P])(1[0-5]|[1-9])$")


def normalize_coordinate(move: str) -> str:
    normalized = move.strip().upper()
    if normalized == "PASS":
        return normalized
    if _COORDINATE_RE.fullmatch(normalized) is None:
        raise ValueError(f"Invalid 15x15 KataGomo coordinate: {move!r}")
    return normalized


def coordinate_to_xy(move: str) -> tuple[int, int]:
    """Return zero-based (x, y-from-top) coordinates."""
    normalized = normalize_coordinate(move)
    if normalized == "PASS":
        raise ValueError("pass has no board coordinate")
    x = COLUMNS.index(normalized[0])
    row_from_bottom = int(normalized[1:])
    return x, BOARD_SIZE - row_from_bottom


def xy_to_coordinate(x: int, y: int) -> str:
    if not (0 <= x < BOARD_SIZE and 0 <= y < BOARD_SIZE):
        raise ValueError(f"Coordinate outside 15x15 board: {(x, y)}")
    return f"{COLUMNS[x]}{BOARD_SIZE - y}"


def coordinate_to_policy_index(move: str) -> int:
    normalized = normalize_coordinate(move)
    if normalized == "PASS":
        return PASS_POLICY_INDEX
    x, y = coordinate_to_xy(normalized)
    return y * BOARD_SIZE + x


def policy_index_to_coordinate(index: int) -> str:
    if index == PASS_POLICY_INDEX:
        return "pass"
    if not (0 <= index < PASS_POLICY_INDEX):
        raise ValueError(f"Policy index outside 0..{PASS_POLICY_INDEX}: {index}")
    return xy_to_coordinate(index % BOARD_SIZE, index // BOARD_SIZE)

