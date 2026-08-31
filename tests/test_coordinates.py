import pytest

from server.coordinates import (
    coordinate_to_policy_index,
    coordinate_to_xy,
    policy_index_to_coordinate,
    xy_to_coordinate,
)


@pytest.mark.parametrize(
    ("move", "xy", "policy_index"),
    [
        ("A15", (0, 0), 0),
        ("H8", (7, 7), 112),
        ("P1", (14, 14), 224),
    ],
)
def test_katago_coordinate_round_trip(move, xy, policy_index):
    assert coordinate_to_xy(move) == xy
    assert xy_to_coordinate(*xy) == move
    assert coordinate_to_policy_index(move) == policy_index
    assert policy_index_to_coordinate(policy_index) == move


def test_policy_pass_index():
    assert coordinate_to_policy_index("pass") == 225
    assert policy_index_to_coordinate(225) == "pass"


@pytest.mark.parametrize("move", ["I8", "A0", "A16", "Q8", ""])
def test_invalid_coordinate(move):
    with pytest.raises(ValueError):
        coordinate_to_policy_index(move)

