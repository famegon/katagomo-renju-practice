from __future__ import annotations

import asyncio
import math
import platform
from collections.abc import Mapping, Sequence
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .config import PROJECT_ROOT, Settings
from .engine import EngineUnavailableError, KataGomoEngine
from .legality import ForbiddenHelper, ForbiddenHelperError
from .schemas import (
    AnalyzeCommand,
    CancelCommand,
    LegalityRequest,
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


class SingleSessionRegistry:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._owner: object | None = None

    async def acquire(self, owner: object) -> bool:
        async with self._lock:
            if self._owner is not None:
                return False
            self._owner = owner
            return True

    async def release(self, owner: object) -> None:
        async with self._lock:
            if self._owner is owner:
                self._owner = None

    @property
    def occupied(self) -> bool:
        return self._owner is not None


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

    app = FastAPI(title="KataGomo Renju Opening Trainer", lifespan=lifespan)
    static_directory = PROJECT_ROOT / "web"
    app.mount("/static", StaticFiles(directory=static_directory), name="static")

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
            "forbiddenHelper": {
                "available": resolved_settings.forbidden_helper_path.is_file(),
                "path": str(resolved_settings.forbidden_helper_path),
            },
            "python": {
                "minimum": "3.11",
                "version": platform.python_version(),
            },
        }

    @app.post("/api/legality")
    async def legality(request: LegalityRequest) -> dict[str, Any]:
        helper: ForbiddenHelper = app.state.forbidden_helper
        try:
            return await helper.analyze(request.moves, request.nextPlayer or "B")
        except ForbiddenHelperError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/training/options")
    async def training_options() -> dict[str, Any]:
        return {
            "endPlyOptions": list(END_PLY_OPTIONS),
            "defaultEndPly": DEFAULT_END_PLY,
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
        if not await sessions.acquire(owner):
            await websocket.send_json(
                {
                    "type": "error",
                    "code": "session_busy",
                    "message": "Only one analysis WebSocket session is allowed",
                }
            )
            await websocket.close(code=1013)
            return

        engine: KataGomoEngine = app.state.engine
        output_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        async def send_results() -> None:
            while True:
                await websocket.send_json(await output_queue.get())

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
                        )
                    elif action == "cancel":
                        CancelCommand.model_validate(raw)
                        canceled = await engine.cancel_for_queue(
                            output_queue, reason="user"
                        )
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
                            "engine": engine.snapshot(),
                        }
                    )
        except WebSocketDisconnect:
            pass
        finally:
            await engine.cancel_for_queue(output_queue, reason="client_disconnected")
            sender.cancel()
            with suppress(asyncio.CancelledError):
                await sender
            await sessions.release(owner)

    return app


app = create_app()
