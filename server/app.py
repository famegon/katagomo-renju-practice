from __future__ import annotations

import asyncio
import math
import platform
import uuid
from collections.abc import Mapping, Sequence
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .config import PROJECT_ROOT, Settings
from .engine import EngineUnavailableError, KataGomoEngine
from .legality import (
    ForbiddenHelper,
    ForbiddenHelperError,
    InvalidRenjuPositionError,
)
from .schemas import (
    AnalyzeCommand,
    CancelCommand,
    LegalityRequest,
    RenjuPositionState,
    TrainingEvaluateRequest,
    TrainingSummaryRequest,
)
from .training import (
    DEFAULT_END_PLY,
    END_PLY_OPTIONS,
    evaluate_training_move,
    summarize_top_mistakes,
)


def _json_safe(value: Any) -> Any:
    """Make validation diagnostics standards-compliant JSON.

    Python's JSON decoder accepts the non-standard NaN/Infinity constants.
    Pydantic correctly rejects them for typed fields, but embeds the original
    non-finite value in its error details.  Starlette's strict response encoder
    cannot serialize that diagnostic unless it is normalized first.
    """

    if isinstance(value, float):
        return value if math.isfinite(value) else repr(value)
    if isinstance(value, Mapping):
        return {str(key): _json_safe(nested) for key, nested in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return [_json_safe(nested) for nested in value]
    if value is None or isinstance(value, (str, int, bool)):
        return value
    return repr(value)


def _client_request_id(raw: Any) -> str | None:
    """Return a safe correlation ID even when the full command is invalid."""

    if not isinstance(raw, Mapping):
        return None
    value = raw.get("clientRequestId")
    return value if isinstance(value, str) else None


class SingleSessionRegistry:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._owner: object | None = None
        self._request_id: str | None = None
        self._connections: set[object] = set()

    async def connect(self, owner: object) -> None:
        async with self._lock:
            self._connections.add(owner)

    async def claim(self, owner: object, request_id: str) -> bool:
        async with self._lock:
            if self._owner is not None and self._owner is not owner:
                return False
            self._owner = owner
            self._request_id = request_id
            return True

    async def release(self, owner: object, request_id: str | None = None) -> None:
        async with self._lock:
            if self._owner is owner and (
                request_id is None or self._request_id == request_id
            ):
                self._owner = None
                self._request_id = None

    async def disconnect(self, owner: object) -> None:
        async with self._lock:
            self._connections.discard(owner)
            if self._owner is owner:
                self._owner = None
                self._request_id = None

    @property
    def occupied(self) -> bool:
        return self._owner is not None

    @property
    def connection_count(self) -> int:
        return len(self._connections)


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = KataGomoEngine(resolved_settings)
        helper = ForbiddenHelper(resolved_settings.forbidden_helper_path)
        sessions = SingleSessionRegistry()
        app.state.engine = engine
        app.state.forbidden_helper = helper
        app.state.sessions = sessions
        await engine.start()
        try:
            yield
        finally:
            await engine.stop()

    app = FastAPI(title="KataGomo Renju Practice", lifespan=lifespan)
    static_directory = PROJECT_ROOT / "web"
    app.mount("/static", StaticFiles(directory=static_directory), name="static")

    @app.middleware("http")
    async def disable_local_ui_cache(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        if request.url.path == "/" or request.url.path.startswith("/static/"):
            # This is a localhost application, not a CDN. Prevent Chrome and
            # Safari from keeping an older app.js/index.html across restarts.
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def request_validation_error_handler(
        _request: object, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"detail": _json_safe(exc.errors())},
        )

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(static_directory / "index.html")

    @app.get("/api/status")
    async def status() -> dict[str, Any]:
        engine: KataGomoEngine = app.state.engine
        sessions: SingleSessionRegistry = app.state.sessions
        return {
            "engine": engine.snapshot(),
            "analysisSessionOccupied": sessions.occupied,
            "analysisConnectionCount": sessions.connection_count,
            "forbiddenHelper": {
                "available": resolved_settings.forbidden_helper_path.is_file(),
                "path": str(resolved_settings.forbidden_helper_path),
            },
            "python": {
                "minimum": "3.11",
                "version": platform.python_version(),
            },
        }

    async def resolve_position(request: LegalityRequest) -> dict[str, Any]:
        helper: ForbiddenHelper = app.state.forbidden_helper
        try:
            return await helper.analyze(request.moves, request.nextPlayer or "B")
        except InvalidRenjuPositionError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except ForbiddenHelperError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.post("/api/position", response_model=RenjuPositionState)
    async def position(request: LegalityRequest) -> dict[str, Any]:
        return await resolve_position(request)

    @app.post("/api/legality", response_model=RenjuPositionState)
    async def legality(request: LegalityRequest) -> dict[str, Any]:
        """Backward-compatible alias for clients from the Stage 2 MVP."""

        return await resolve_position(request)

    @app.get("/api/training/options")
    async def training_options() -> dict[str, Any]:
        return {
            "endPlyOptions": list(END_PLY_OPTIONS),
            "defaultEndPly": DEFAULT_END_PLY,
            "manualFinishSupported": True,
            "manualEndValue": "manual",
            "minimumCandidateVisits": 50,
            "winratePerspective": "BLACK",
            "scoreContract": "metrics-only-no-opaque-score",
        }

    @app.post("/api/training/evaluate")
    async def training_evaluate(request: TrainingEvaluateRequest) -> dict[str, Any]:
        try:
            evaluation = evaluate_training_move(
                ply=request.ply,
                user_move=request.userMove,
                user_color=request.userColor,
                pre_analysis=request.preAnalysis,
                post_root_info=request.postRootInfo,
                terminal_state=(
                    request.terminalState.model_dump()
                    if request.terminalState is not None
                    else None
                ),
                minimum_candidate_visits=request.minimumCandidateVisits,
                legal_moves=request.legalMoves,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        evaluation.update(
            {
                "clientEvaluationId": request.clientEvaluationId,
                "sessionEpoch": request.sessionEpoch,
                "prePositionRevision": request.prePositionRevision,
                "postPositionRevision": request.postPositionRevision,
            }
        )
        return evaluation

    @app.post("/api/training/summary")
    async def training_summary(request: TrainingSummaryRequest) -> dict[str, Any]:
        try:
            top_mistakes = summarize_top_mistakes(
                request.evaluations, limit=request.limit
            )
        except (TypeError, ValueError, OverflowError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {
            "topMistakes": top_mistakes,
            "evaluationCount": len(request.evaluations),
            "insufficientCount": sum(
                1
                for evaluation in request.evaluations
                if bool(evaluation.get("analysisInsufficient", False))
            ),
            "clientSummaryId": request.clientSummaryId,
            "sessionEpoch": request.sessionEpoch,
            "positionRevision": request.positionRevision,
        }

    @app.websocket("/ws/analysis")
    async def analysis_websocket(websocket: WebSocket) -> None:
        await websocket.accept()
        owner = object()
        sessions: SingleSessionRegistry = app.state.sessions
        await sessions.connect(owner)

        engine: KataGomoEngine = app.state.engine
        output_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        async def send_results() -> None:
            while True:
                message = await output_queue.get()
                request_id = message.get("requestId")
                is_terminal = (
                    message.get("type") == "error"
                    or (
                        message.get("type") == "status"
                        and message.get("status") == "canceled"
                    )
                    or (
                        message.get("type") == "analysis"
                        and message.get("isFinal") is True
                    )
                )
                try:
                    await websocket.send_json(message)
                finally:
                    if is_terminal and isinstance(request_id, str):
                        await sessions.release(owner, request_id)

        sender = asyncio.create_task(send_results())
        try:
            await websocket.send_json(
                {"type": "status", "status": "connected", "engine": engine.snapshot()}
            )
            while True:
                raw = await websocket.receive_json()
                action = raw.get("action") if isinstance(raw, dict) else None
                try:
                    if action == "analyze":
                        command = AnalyzeCommand.model_validate(raw)
                        helper: ForbiddenHelper = app.state.forbidden_helper
                        game_state = await helper.analyze(
                            command.moves,
                            "B" if len(command.moves) % 2 == 0 else "W",
                        )
                        if game_state["isTerminal"]:
                            # A valid terminal position supersedes any search
                            # already owned by this connection. Do not leave
                            # that obsolete search consuming the global lease
                            # after telling the client that no MCTS is needed.
                            canceled = await engine.cancel_for_queue(
                                output_queue, reason="terminal_position"
                            )
                            if canceled:
                                await sessions.release(owner)
                            await websocket.send_json(
                                {
                                    "type": "position",
                                    "status": "terminal",
                                    "code": "position_terminal",
                                    "message": "The Renju game has already ended",
                                    "clientRequestId": command.clientRequestId,
                                    "positionRevision": command.positionRevision,
                                    "sessionEpoch": command.sessionEpoch,
                                    "gameState": game_state,
                                }
                            )
                            continue
                        request_id = uuid.uuid4().hex
                        if not await sessions.claim(owner, request_id):
                            await websocket.send_json(
                                {
                                    "type": "error",
                                    "code": "session_busy",
                                    "message": (
                                        "Another browser is currently analyzing; "
                                        "retry when that analysis finishes"
                                    ),
                                    "clientRequestId": command.clientRequestId,
                                }
                            )
                            continue
                        try:
                            await engine.submit(
                                moves=command.moves,
                                max_visits=command.maxVisits,
                                report_during_search_every=command.reportDuringSearchEvery,
                                user_color=command.userColor,
                                client_request_id=command.clientRequestId,
                                output_queue=output_queue,
                                analysis_purpose=command.analysisPurpose,
                                position_revision=command.positionRevision,
                                session_epoch=command.sessionEpoch,
                                request_id=request_id,
                            )
                        except Exception:
                            await sessions.release(owner, request_id)
                            raise
                    elif action == "cancel":
                        CancelCommand.model_validate(raw)
                        canceled = await engine.cancel_for_queue(
                            output_queue, reason="user"
                        )
                        if canceled:
                            await sessions.release(owner)
                        if not canceled:
                            await websocket.send_json(
                                {
                                    "type": "status",
                                    "status": "idle",
                                    "message": "No active analysis to cancel",
                                    "engine": engine.snapshot(),
                                }
                            )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "code": "invalid_action",
                                "message": "action must be analyze or cancel",
                            }
                        )
                except ValidationError as exc:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "validation_error",
                            "message": "Invalid analysis request",
                            "clientRequestId": _client_request_id(raw),
                            "details": _json_safe(
                                exc.errors(include_url=False, include_context=False)
                            ),
                        }
                    )
                except EngineUnavailableError as exc:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "engine_unavailable",
                            "message": str(exc),
                            "clientRequestId": _client_request_id(raw),
                            "engine": engine.snapshot(),
                        }
                    )
                except InvalidRenjuPositionError as exc:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "invalid_position",
                            "message": str(exc),
                            "clientRequestId": _client_request_id(raw),
                        }
                    )
                except ForbiddenHelperError as exc:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "position_validation_unavailable",
                            "message": str(exc),
                            "clientRequestId": _client_request_id(raw),
                        }
                    )
        except WebSocketDisconnect:
            pass
        finally:
            await engine.cancel_for_queue(output_queue, reason="client_disconnected")
            await sessions.release(owner)
            sender.cancel()
            with suppress(asyncio.CancelledError):
                await sender
            await sessions.disconnect(owner)

    return app


app = create_app()
