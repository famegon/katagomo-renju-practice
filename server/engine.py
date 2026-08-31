from __future__ import annotations

import asyncio
import json
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .analysis import AnalysisProtocolError, transform_analysis_response
from .config import Settings


class EngineUnavailableError(RuntimeError):
    pass


@dataclass(slots=True)
class ActiveRequest:
    engine_request_id: str
    request_id: str
    client_request_id: str | None
    user_color: str
    output_queue: asyncio.Queue[dict[str, Any]]


class KataGomoEngine:
    """Own one persistent KataGomo analysis process and one active query."""

    def __init__(self, settings: Settings, *, restart_limit: int = 1) -> None:
        self.settings = settings
        self.restart_limit = restart_limit
        self.process: asyncio.subprocess.Process | None = None
        self.state = "stopped"
        self.last_error: str | None = None
        self.active: ActiveRequest | None = None
        self.start_count = 0
        self.restart_count = 0
        self.stale_response_count = 0
        self._generation = 0
        self._stopping = False
        self._command_lock = asyncio.Lock()
        self._spawn_lock = asyncio.Lock()
        self._tasks: set[asyncio.Task[Any]] = set()
        self._stderr_tail: deque[str] = deque(maxlen=50)
        self._control_waiters: dict[str, asyncio.Future[dict[str, Any]]] = {}

    async def start(self) -> None:
        self._validate_paths()
        self._stopping = False
        self.restart_count = 0
        await self._spawn_process()

    def _validate_paths(self) -> None:
        if not self.settings.engine_path.is_file():
            raise EngineUnavailableError(
                f"KataGomo executable not found: {self.settings.engine_path}"
            )
        if not self.settings.model_path.is_file():
            raise EngineUnavailableError(
                f"KataGomo model not found: {self.settings.model_path}"
            )
        if not self.settings.analysis_config_path.is_file():
            raise EngineUnavailableError(
                f"Analysis config not found: {self.settings.analysis_config_path}"
            )

    async def _spawn_process(self) -> None:
        async with self._spawn_lock:
            if self._stopping:
                return
            self.state = "starting"
            self.settings.engine_stderr_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                process = await asyncio.create_subprocess_exec(
                    str(self.settings.engine_path),
                    "analysis",
                    "-config",
                    str(self.settings.analysis_config_path),
                    "-model",
                    str(self.settings.model_path),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            except Exception as exc:
                self.state = "error"
                self.last_error = f"Failed to start KataGomo: {exc}"
                raise EngineUnavailableError(self.last_error) from exc

            self.process = process
            self._generation += 1
            generation = self._generation
            self.start_count += 1
            self.last_error = None
            self._track_task(self._read_stdout(process, generation))
            self._track_task(self._read_stderr(process, generation))
            self._track_task(self._watch_process(process, generation))
            control_id = f"startup-{uuid.uuid4().hex}"
            waiter = asyncio.get_running_loop().create_future()
            self._control_waiters[control_id] = waiter
            await self._send_json({"id": control_id, "action": "query_version"})
            try:
                await asyncio.wait_for(waiter, timeout=120.0)
            except TimeoutError as exc:
                self._control_waiters.pop(control_id, None)
                self.state = "error"
                self.last_error = "KataGomo readiness query timed out"
                if process.returncode is None:
                    process.terminate()
                raise EngineUnavailableError(self.last_error) from exc
            self.state = "ready"

    def _track_task(self, coroutine: Any) -> asyncio.Task[Any]:
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def stop(self) -> None:
        self._stopping = True
        self.state = "stopping"
        await self.cancel_active(reason="server_shutdown")
        process = self.process
        if process is not None and process.returncode is None:
            try:
                await self._send_json(
                    {
                        "id": f"shutdown-{uuid.uuid4().hex}",
                        "action": "terminate_all",
                    },
                    allow_stopping=True,
                )
            except EngineUnavailableError:
                pass
            if process.stdin is not None:
                process.stdin.close()
                try:
                    await process.stdin.wait_closed()
                except (BrokenPipeError, ConnectionResetError):
                    pass
            try:
                await asyncio.wait_for(process.wait(), timeout=10.0)
            except TimeoutError:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=3.0)
                except TimeoutError:
                    process.kill()
                    await process.wait()

        current = asyncio.current_task()
        remaining = [task for task in self._tasks if task is not current]
        for task in remaining:
            task.cancel()
        if remaining:
            await asyncio.gather(*remaining, return_exceptions=True)
        self.process = None
        self.state = "stopped"

    async def submit(
        self,
        *,
        moves: list[tuple[str, str]],
        max_visits: int,
        report_during_search_every: float,
        user_color: str,
        client_request_id: str | None,
        output_queue: asyncio.Queue[dict[str, Any]],
    ) -> str:
        await self.cancel_active(reason="superseded")
        process = self.process
        if (
            process is None
            or process.returncode is not None
            or process.stdin is None
            or self.state not in {"ready", "analyzing"}
        ):
            raise EngineUnavailableError(
                self.last_error or f"KataGomo is not ready (state={self.state})"
            )

        request_id = uuid.uuid4().hex
        engine_request_id = f"analysis-{request_id}"
        context = ActiveRequest(
            engine_request_id=engine_request_id,
            request_id=request_id,
            client_request_id=client_request_id,
            user_color=user_color,
            output_queue=output_queue,
        )
        self.active = context
        self.state = "analyzing"
        engine_request = {
            "id": engine_request_id,
            "moves": [[player, move] for player, move in moves],
            "rules": {
                "basicrule": "RENJU",
                "vcnrule": "NOVC",
                "firstpasswin": False,
                "maxmoves": 0,
            },
            "boardXSize": 15,
            "boardYSize": 15,
            "maxVisits": max_visits,
            "analysisPVLen": 15,
            "includePolicy": True,
            "includePVVisits": True,
            "reportDuringSearchEvery": report_during_search_every,
            "overrideSettings": {
                "reportAnalysisWinratesAs": "BLACK",
                "wideRootNoise": 0.0,
                "rootSymmetryPruning": False,
            },
        }
        try:
            await self._send_json(engine_request)
        except Exception:
            if self.active is context:
                self.active = None
                self.state = "ready" if process.returncode is None else "error"
            raise
        await output_queue.put(
            {
                "type": "status",
                "status": "analyzing",
                "requestId": request_id,
                "clientRequestId": client_request_id,
                "engine": self.snapshot(),
            }
        )
        return request_id

    async def cancel_active(self, *, reason: str = "user") -> bool:
        context = self.active
        if context is None:
            return False
        self.active = None
        process = self.process
        if process is not None and process.returncode is None:
            try:
                await self._send_json(
                    {
                        "id": f"control-{uuid.uuid4().hex}",
                        "action": "terminate",
                        "terminateId": context.engine_request_id,
                    }
                )
            except EngineUnavailableError:
                pass
        if self.state == "analyzing":
            self.state = "ready" if process and process.returncode is None else "error"
        await context.output_queue.put(
            {
                "type": "status",
                "status": "canceled",
                "reason": reason,
                "requestId": context.request_id,
                "clientRequestId": context.client_request_id,
                "engine": self.snapshot(),
            }
        )
        return True

    async def cancel_for_queue(
        self, output_queue: asyncio.Queue[dict[str, Any]], *, reason: str
    ) -> bool:
        if self.active is None or self.active.output_queue is not output_queue:
            return False
        return await self.cancel_active(reason=reason)

    async def _send_json(
        self, value: dict[str, Any], *, allow_stopping: bool = False
    ) -> None:
        async with self._command_lock:
            process = self.process
            if (
                process is None
                or process.returncode is not None
                or process.stdin is None
                or (self._stopping and not allow_stopping)
            ):
                raise EngineUnavailableError("KataGomo stdin is unavailable")
            line = json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n"
            process.stdin.write(line.encode("utf-8"))
            try:
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as exc:
                raise EngineUnavailableError("KataGomo stdin closed unexpectedly") from exc

    async def _read_stdout(
        self, process: asyncio.subprocess.Process, generation: int
    ) -> None:
        assert process.stdout is not None
        invalid_path = self.settings.engine_stderr_path.with_name(
            "engine-invalid-stdout.log"
        )
        while True:
            line = await process.stdout.readline()
            if not line:
                return
            try:
                raw = json.loads(line)
                if not isinstance(raw, dict):
                    raise ValueError("top-level JSON value is not an object")
            except Exception as exc:
                invalid_path.parent.mkdir(parents=True, exist_ok=True)
                with invalid_path.open("ab") as output:
                    output.write(line)
                self.last_error = f"Invalid JSON on KataGomo stdout: {exc}"
                continue

            if generation != self._generation:
                self.stale_response_count += 1
                continue
            response_id = raw.get("id")
            waiter = self._control_waiters.pop(str(response_id), None)
            if waiter is not None:
                if not waiter.done():
                    waiter.set_result(raw)
                continue
            if isinstance(response_id, str) and response_id.startswith(
                ("control-", "shutdown-")
            ):
                continue
            context = self.active
            if context is None or response_id != context.engine_request_id:
                self.stale_response_count += 1
                continue

            if "error" in raw:
                await context.output_queue.put(
                    {
                        "type": "error",
                        "code": "engine_request_error",
                        "message": str(raw.get("error")),
                        "requestId": context.request_id,
                        "clientRequestId": context.client_request_id,
                        "engineResponse": raw,
                    }
                )
                if self.active is context:
                    self.active = None
                    self.state = "ready"
                continue

            if "warning" in raw:
                await context.output_queue.put(
                    {
                        "type": "warning",
                        "code": "engine_warning",
                        "message": str(raw.get("warning")),
                        "requestId": context.request_id,
                        "clientRequestId": context.client_request_id,
                        "engineResponse": raw,
                    }
                )
                continue

            try:
                transformed = transform_analysis_response(
                    raw,
                    request_id=context.request_id,
                    user_color=context.user_color,
                )
            except AnalysisProtocolError as exc:
                await context.output_queue.put(
                    {
                        "type": "error",
                        "code": "engine_protocol_error",
                        "message": str(exc),
                        "requestId": context.request_id,
                        "clientRequestId": context.client_request_id,
                    }
                )
                if self.active is context:
                    self.active = None
                    self.state = "ready"
                try:
                    await self._send_json(
                        {
                            "id": f"control-{uuid.uuid4().hex}",
                            "action": "terminate",
                            "terminateId": context.engine_request_id,
                        }
                    )
                except EngineUnavailableError:
                    pass
                continue
            transformed["clientRequestId"] = context.client_request_id
            await context.output_queue.put(transformed)
            if transformed["isFinal"] and self.active is context:
                self.active = None
                self.state = "ready"

    async def _read_stderr(
        self, process: asyncio.subprocess.Process, generation: int
    ) -> None:
        assert process.stderr is not None
        with self.settings.engine_stderr_path.open("ab") as output:
            while True:
                line = await process.stderr.readline()
                if not line:
                    return
                output.write(line)
                output.flush()
                self._stderr_tail.append(line.decode("utf-8", errors="replace").rstrip())
                if generation != self._generation:
                    return

    async def _watch_process(
        self, process: asyncio.subprocess.Process, generation: int
    ) -> None:
        return_code = await process.wait()
        if self._stopping or generation != self._generation:
            return
        self.process = None
        for control_id, waiter in list(self._control_waiters.items()):
            if not waiter.done():
                waiter.set_exception(
                    EngineUnavailableError(
                        f"KataGomo exited before control response: {control_id}"
                    )
                )
        self._control_waiters.clear()
        context = self.active
        self.active = None
        self.last_error = f"KataGomo exited unexpectedly with code {return_code}"
        if context is not None:
            await context.output_queue.put(
                {
                    "type": "error",
                    "code": "engine_exited",
                    "message": self.last_error,
                    "requestId": context.request_id,
                    "clientRequestId": context.client_request_id,
                    "restartAttempted": self.restart_count < self.restart_limit,
                }
            )
        if self.restart_count < self.restart_limit:
            self.restart_count += 1
            self.state = "restarting"
            try:
                await self._spawn_process()
            except EngineUnavailableError:
                self.state = "error"
        else:
            self.state = "error"

    def snapshot(self) -> dict[str, Any]:
        process = self.process
        return {
            "state": self.state,
            "pid": process.pid if process is not None else None,
            "activeRequestId": self.active.request_id if self.active else None,
            "startCount": self.start_count,
            "restartCount": self.restart_count,
            "restartLimit": self.restart_limit,
            "staleResponsesIgnored": self.stale_response_count,
            "lastError": self.last_error,
            "stderrTail": list(self._stderr_tail)[-10:],
        }
