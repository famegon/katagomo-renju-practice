from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .schemas import RenjuPositionState


class ForbiddenHelperError(RuntimeError):
    pass


class InvalidRenjuPositionError(ForbiddenHelperError):
    pass


class ForbiddenHelper:
    def __init__(self, executable: Path) -> None:
        self.executable = executable

    async def analyze(
        self, moves: list[tuple[str, str]], next_player: str
    ) -> dict[str, Any]:
        if not self.executable.is_file():
            raise ForbiddenHelperError(
                f"Forbidden helper is not built: {self.executable}"
            )
        try:
            process = await asyncio.create_subprocess_exec(
                str(self.executable),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as exc:
            raise ForbiddenHelperError(
                f"Could not start the Renju position helper: {exc}"
            ) from exc
        request = {
            "boardXSize": 15,
            "boardYSize": 15,
            "moves": [[player, move] for player, move in moves],
            "nextPlayer": next_player,
        }
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(
                    (json.dumps(request, separators=(",", ":")) + "\n").encode(
                        "utf-8"
                    )
                ),
                timeout=5.0,
            )
        except TimeoutError as exc:
            process.kill()
            await process.wait()
            raise ForbiddenHelperError(
                "Renju position helper timed out after 5 seconds"
            ) from exc
        if process.returncode != 0:
            message = stderr.decode("utf-8", errors="replace").strip()
            error_type = (
                InvalidRenjuPositionError
                if process.returncode == 2
                else ForbiddenHelperError
            )
            raise error_type(
                f"Forbidden helper exited with {process.returncode}: {message}"
            )
        try:
            result = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise ForbiddenHelperError(
                f"Forbidden helper returned invalid JSON: {stdout!r}"
            ) from exc
        if not isinstance(result, dict):
            raise ForbiddenHelperError("Forbidden helper response must be an object")
        try:
            return RenjuPositionState.model_validate(result).model_dump()
        except ValidationError as exc:
            raise ForbiddenHelperError(
                f"Forbidden helper violated the Renju position contract: {exc}"
            ) from exc
