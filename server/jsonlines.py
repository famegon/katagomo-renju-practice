from __future__ import annotations

import json
from typing import Any


class JsonLineBuffer:
    """Incrementally parse UTF-8 JSON Lines from arbitrary byte chunks."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, chunk: bytes) -> list[dict[str, Any]]:
        self._buffer.extend(chunk)
        parsed: list[dict[str, Any]] = []
        while True:
            newline = self._buffer.find(b"\n")
            if newline < 0:
                break
            raw_line = bytes(self._buffer[:newline]).rstrip(b"\r")
            del self._buffer[: newline + 1]
            if not raw_line.strip():
                continue
            value = json.loads(raw_line.decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError("JSON Lines value must be an object")
            parsed.append(value)
        return parsed

    def finish(self) -> None:
        if self._buffer.strip():
            raise ValueError("Incomplete JSON line at end of stream")
        self._buffer.clear()

