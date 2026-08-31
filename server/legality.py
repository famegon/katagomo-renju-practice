from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any


class ForbiddenHelperError(RuntimeError):
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
        process = await asyncio.create_subprocess_exec(
            str(self.executable),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        request = {
            "boardXSize": 15,
            "boardYSize": 15,
            "moves": [[player, move] for player, move in moves],
            "nextPlayer": next_player,
        }
        stdout, stderr = await asyncio.wait_for(
            process.communicate(
                (json.dumps(request, separators=(",", ":")) + "\n").encode("utf-8")
            ),
            timeout=5.0,
        )
        if process.returncode != 0:
            message = stderr.decode("utf-8", errors="replace").strip()
            raise ForbiddenHelperError(
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
        return result

