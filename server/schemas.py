from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .coordinates import normalize_coordinate


Player = Literal["B", "W"]
MovePair = tuple[Player, str]


def _validate_moves(moves: list[MovePair]) -> list[MovePair]:
    normalized: list[MovePair] = []
    occupied: set[str] = set()
    for index, (player, move) in enumerate(moves):
        expected: Player = "B" if index % 2 == 0 else "W"
        if player != expected:
            raise ValueError(
                f"Move {index + 1} must be played by {expected}, got {player}"
            )
        coordinate = normalize_coordinate(move)
        if coordinate == "PASS":
            raise ValueError("Diagnostic 15x15 positions do not accept pass moves")
        if coordinate in occupied:
            raise ValueError(f"Duplicate occupied coordinate: {coordinate}")
        occupied.add(coordinate)
        normalized.append((player, coordinate))
    return normalized


class AnalyzeCommand(BaseModel):
    action: Literal["analyze"] = "analyze"
    moves: list[MovePair] = Field(default_factory=list, max_length=225)
    rules: Literal["renju"] = "renju"
    boardXSize: Literal[15] = 15
    boardYSize: Literal[15] = 15
    maxVisits: Annotated[int, Field(ge=1, le=10_000)] = 100
    reportDuringSearchEvery: Annotated[float, Field(ge=0.001, le=60.0)] = 0.5
    userColor: Player = "B"
    clientRequestId: str | None = Field(default=None, max_length=128)
    analysisPurpose: Literal[
        "manual", "user_pre", "post_user_ai", "final_grade"
    ] = "manual"
    positionRevision: Annotated[int, Field(ge=0)] = 0
    sessionEpoch: str | None = Field(default=None, max_length=128)

    @field_validator("moves")
    @classmethod
    def validate_moves(cls, moves: list[MovePair]) -> list[MovePair]:
        return _validate_moves(moves)


class CancelCommand(BaseModel):
    action: Literal["cancel"]


class LegalityRequest(BaseModel):
    moves: list[MovePair] = Field(default_factory=list, max_length=225)
    nextPlayer: Player | None = None

    @field_validator("moves")
    @classmethod
    def validate_moves(cls, moves: list[MovePair]) -> list[MovePair]:
        return _validate_moves(moves)

    @model_validator(mode="after")
    def validate_next_player(self) -> "LegalityRequest":
        expected: Player = "B" if len(self.moves) % 2 == 0 else "W"
        if self.nextPlayer is None:
            self.nextPlayer = expected
        elif self.nextPlayer != expected:
            raise ValueError(
                f"nextPlayer must be {expected} for {len(self.moves)} moves"
            )
        return self


class RenjuPositionState(BaseModel):
    boardXSize: Literal[15]
    boardYSize: Literal[15]
    rules: Literal["renju"]
    isValid: Literal[True]
    moveCount: Annotated[int, Field(ge=0, le=225)]
    nextPlayer: Player
    isTerminal: bool
    winner: Player | None
    outcome: Literal["ongoing", "black_win", "white_win", "draw"]
    terminalReason: Literal["line_win", "black_forbidden", "board_full"] | None
    terminalMove: str | None
    forbiddenMoves: list[str]
    legalMoves: list[str]
    source: Literal["KataGomo Board::isForbidden()"]
    historySource: Literal[
        "KataGomo BoardHistory::makeBoardMoveAssumeLegal()"
    ]

    @field_validator("terminalMove")
    @classmethod
    def validate_terminal_move(cls, move: str | None) -> str | None:
        if move is None:
            return None
        coordinate = normalize_coordinate(move)
        if coordinate == "PASS":
            raise ValueError("terminalMove must be a board coordinate")
        return coordinate

    @field_validator("forbiddenMoves", "legalMoves")
    @classmethod
    def validate_position_moves(cls, moves: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for move in moves:
            coordinate = normalize_coordinate(move)
            if coordinate == "PASS":
                raise ValueError("position move lists cannot contain PASS")
            if coordinate in seen:
                raise ValueError(f"duplicate position coordinate: {coordinate}")
            seen.add(coordinate)
            normalized.append(coordinate)
        return normalized

    @model_validator(mode="after")
    def validate_terminal_contract(self) -> "RenjuPositionState":
        expected_next: Player = "B" if self.moveCount % 2 == 0 else "W"
        if self.nextPlayer != expected_next:
            raise ValueError(
                f"nextPlayer must be {expected_next} for {self.moveCount} moves"
            )
        if set(self.legalMoves) & set(self.forbiddenMoves):
            raise ValueError("legalMoves and forbiddenMoves must be disjoint")
        if self.isTerminal:
            if self.outcome == "ongoing" or self.terminalReason is None:
                raise ValueError("terminal positions require an outcome and reason")
            if self.terminalMove is None:
                raise ValueError("terminal positions require terminalMove")
            if self.legalMoves or self.forbiddenMoves:
                raise ValueError("terminal positions cannot expose playable moves")
            if self.outcome == "black_win":
                if self.winner != "B" or self.terminalReason != "line_win":
                    raise ValueError("black_win requires winner B and line_win")
            elif self.outcome == "white_win":
                if self.winner != "W" or self.terminalReason not in {
                    "line_win",
                    "black_forbidden",
                }:
                    raise ValueError(
                        "white_win requires winner W and a valid win reason"
                    )
            elif self.outcome == "draw":
                if self.winner is not None or self.terminalReason != "board_full":
                    raise ValueError("draw requires a null winner and board_full")
        else:
            if self.outcome != "ongoing" or self.winner is not None:
                raise ValueError("ongoing positions cannot have a winner")
            if self.terminalReason is not None or self.terminalMove is not None:
                raise ValueError("ongoing positions cannot have terminal metadata")
            if self.nextPlayer == "W" and self.forbiddenMoves:
                raise ValueError("white turns cannot expose black forbidden moves")
            if len(self.legalMoves) + len(self.forbiddenMoves) != 225 - self.moveCount:
                raise ValueError(
                    "ongoing legalMoves and forbiddenMoves must cover every empty point"
                )
        return self


class TrainingEvaluateRequest(BaseModel):
    ply: Annotated[int, Field(ge=1, le=225)]
    userMove: str
    userColor: Player
    preAnalysis: dict[str, Any]
    postRootInfo: dict[str, Any] | None = None
    terminalState: RenjuPositionState | None = None
    legalMoves: list[str] | None = None
    minimumCandidateVisits: Annotated[int, Field(ge=0)] = 50
    clientEvaluationId: str | None = Field(default=None, max_length=128)
    sessionEpoch: str | None = Field(default=None, max_length=128)
    prePositionRevision: Annotated[int | None, Field(ge=0)] = None
    postPositionRevision: Annotated[int | None, Field(ge=0)] = None

    @model_validator(mode="after")
    def validate_post_result(self) -> "TrainingEvaluateRequest":
        if (self.postRootInfo is None) == (self.terminalState is None):
            raise ValueError(
                "exactly one of postRootInfo or terminalState must be provided"
            )
        if self.terminalState is not None and not self.terminalState.isTerminal:
            raise ValueError("terminalState must describe a terminal position")
        return self

    @field_validator("userMove")
    @classmethod
    def validate_user_move(cls, move: str) -> str:
        coordinate = normalize_coordinate(move)
        if coordinate == "PASS":
            raise ValueError("Training evaluations do not accept pass")
        return coordinate

    @field_validator("legalMoves")
    @classmethod
    def validate_legal_moves(cls, moves: list[str] | None) -> list[str] | None:
        if moves is None:
            return None
        normalized: list[str] = []
        for move in moves:
            coordinate = normalize_coordinate(move)
            if coordinate != "PASS":
                normalized.append(coordinate)
        return normalized


class TrainingSummaryRequest(BaseModel):
    evaluations: list[dict[str, Any]] = Field(default_factory=list, max_length=113)
    limit: Annotated[int, Field(ge=0, le=3)] = 3
    clientSummaryId: str | None = Field(default=None, max_length=128)
    sessionEpoch: str | None = Field(default=None, max_length=128)
    positionRevision: Annotated[int | None, Field(ge=0)] = None
