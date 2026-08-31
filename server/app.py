from __future__ import annotations

import asyncio
import platform
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .config import PROJECT_ROOT, Settings
from .engine import EngineUnavailableError, KataGomoEngine
from .legality import ForbiddenHelper, ForbiddenHelperError
from .schemas import AnalyzeCommand, CancelCommand, LegalityRequest


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

    app = FastAPI(title="KataGomo Opening Trainer Diagnostics", lifespan=lifespan)
    static_directory = PROJECT_ROOT / "web"
    app.mount("/static", StaticFiles(directory=static_directory), name="static")

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
                            "details": exc.errors(
                                include_url=False, include_context=False
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
