from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path
import sys

import pytest

from server.engine import EngineUnavailableError, KataGomoEngine


async def next_of_type(queue, event_type):
    while True:
        value = await asyncio.wait_for(queue.get(), timeout=5)
        if value.get("type") == event_type:
            return value


def settings_with_broken_stdout(fake_settings, tmp_path: Path, mode: str):
    marker = tmp_path / f"{mode}-failed-once"
    wrapper = tmp_path / f"broken-stdout-{mode}"
    fake_engine = fake_settings.engine_path
    wrapper.write_text(
        f"""#!{sys.executable}
import json
import os
from pathlib import Path
import sys
import time

mode = {mode!r}
marker = Path({str(marker)!r})
fake_engine = {str(fake_engine)!r}

if marker.exists():
    os.execv(sys.executable, [sys.executable, fake_engine])

for line in sys.stdin:
    request = json.loads(line)
    if request.get("action") == "query_version":
        print(json.dumps({{"id": request["id"], "version": "broken-stdout"}}), flush=True)
        continue

    marker.touch()
    if mode == "malformed":
        os.write(sys.stdout.fileno(), b"not-json\\n")
    elif mode == "truncated":
        os.write(sys.stdout.fileno(), b'{{"id":')
        os.close(sys.stdout.fileno())
    else:
        os.close(sys.stdout.fileno())
    time.sleep(60)
""",
        encoding="utf-8",
    )
    wrapper.chmod(0o755)
    return replace(fake_settings, engine_path=wrapper)


@pytest.mark.asyncio
async def test_request_cancel_and_late_response_ignored(fake_settings):
    engine = KataGomoEngine(fake_settings)
    await engine.start()
    queue = asyncio.Queue()
    try:
        request_id = await engine.submit(
            moves=[],
            max_visits=100,
            report_during_search_every=0.5,
            user_color="B",
            client_request_id="cancel-me",
            output_queue=queue,
        )
        await next_of_type(queue, "analysis")
        assert await engine.cancel_active(reason="test") is True
        canceled = await next_of_type(queue, "status")
        while canceled.get("status") != "canceled":
            canceled = await next_of_type(queue, "status")
        assert canceled["requestId"] == request_id
        await asyncio.sleep(0.05)
        assert engine.active is None
        assert engine.stale_response_count >= 1
    finally:
        await engine.stop()


@pytest.mark.asyncio
async def test_new_request_supersedes_old_and_stale_results_do_not_leak(fake_settings):
    engine = KataGomoEngine(fake_settings)
    await engine.start()
    old_queue = asyncio.Queue()
    new_queue = asyncio.Queue()
    try:
        await engine.submit(
            moves=[], max_visits=100, report_during_search_every=0.5,
            user_color="B", client_request_id="old", output_queue=old_queue,
        )
        await next_of_type(old_queue, "analysis")
        new_id = await engine.submit(
            moves=[], max_visits=42, report_during_search_every=0.5,
            user_color="W", client_request_id="new", output_queue=new_queue,
        )
        results = []
        while True:
            value = await asyncio.wait_for(new_queue.get(), timeout=5)
            if value.get("type") == "analysis":
                results.append(value)
                if value["isFinal"]:
                    break
        assert results
        assert all(result["requestId"] == new_id for result in results)
        assert all(result["clientRequestId"] == "new" for result in results)
        assert engine.stale_response_count >= 1
    finally:
        await engine.stop()


@pytest.mark.asyncio
async def test_engine_exit_is_reported_and_restarted_once(fake_settings):
    engine = KataGomoEngine(fake_settings, restart_limit=1)
    await engine.start()
    queue = asyncio.Queue()
    try:
        await engine.submit(
            moves=[], max_visits=13, report_during_search_every=0.5,
            user_color="B", client_request_id="crash", output_queue=queue,
        )
        error = await next_of_type(queue, "error")
        assert error["code"] == "engine_exited"
        for _ in range(100):
            if engine.state == "ready" and engine.start_count == 2:
                break
            await asyncio.sleep(0.02)
        assert engine.state == "ready"
        assert engine.start_count == 2
        assert engine.restart_count == 1
    finally:
        await engine.stop()


@pytest.mark.asyncio
async def test_malformed_policy_is_reported_instead_of_used_as_raw_prior(fake_settings):
    engine = KataGomoEngine(fake_settings)
    await engine.start()
    queue = asyncio.Queue()
    try:
        await engine.submit(
            moves=[], max_visits=7, report_during_search_every=0.5,
            user_color="B", client_request_id="bad-policy", output_queue=queue,
        )
        error = await next_of_type(queue, "error")
        assert error["code"] == "engine_protocol_error"
        assert error["clientRequestId"] == "bad-policy"
        assert "policy length must be 226" in error["message"]
        assert engine.active is None
    finally:
        await engine.stop()


@pytest.mark.asyncio
async def test_malformed_numeric_response_does_not_kill_stdout_reader(fake_settings):
    engine = KataGomoEngine(fake_settings)
    await engine.start()
    malformed_queue = asyncio.Queue()
    recovery_queue = asyncio.Queue()
    try:
        await engine.submit(
            moves=[], max_visits=8, report_during_search_every=0.5,
            user_color="B", client_request_id="bad-visits",
            output_queue=malformed_queue,
        )
        error = await next_of_type(malformed_queue, "error")
        assert error["code"] == "engine_protocol_error"
        assert error["clientRequestId"] == "bad-visits"
        assert "moveInfos[0].visits" in error["message"]
        assert engine.active is None
        assert engine.state == "ready"

        await engine.submit(
            moves=[], max_visits=42, report_during_search_every=0.5,
            user_color="B", client_request_id="after-bad-response",
            output_queue=recovery_queue,
        )
        final = await next_of_type(recovery_queue, "analysis")
        while not final["isFinal"]:
            final = await next_of_type(recovery_queue, "analysis")
        assert final["clientRequestId"] == "after-bad-response"
        assert engine.state == "ready"
    finally:
        await engine.stop()


@pytest.mark.asyncio
async def test_background_reader_failure_is_reported_and_restarted_once(
    fake_settings, monkeypatch
):
    engine = KataGomoEngine(fake_settings, restart_limit=1)
    original_read_stderr = engine._read_stderr
    fail_first_reader = asyncio.Event()
    reader_start_count = 0

    async def flaky_read_stderr(process, generation):
        nonlocal reader_start_count
        reader_start_count += 1
        if reader_start_count == 1:
            await fail_first_reader.wait()
            raise RuntimeError("synthetic stderr reader failure")
        await original_read_stderr(process, generation)

    monkeypatch.setattr(engine, "_read_stderr", flaky_read_stderr)
    await engine.start()
    queue = asyncio.Queue()
    try:
        await engine.submit(
            moves=[], max_visits=6, report_during_search_every=0.5,
            user_color="B", client_request_id="reader-failure",
            output_queue=queue,
        )
        fail_first_reader.set()
        error = await next_of_type(queue, "error")
        assert error["code"] == "engine_background_error"
        assert error["clientRequestId"] == "reader-failure"
        assert error["backgroundTask"] == "stderr reader"
        assert error["restartAttempted"] is True
        assert "synthetic stderr reader failure" in error["message"]
        assert engine.active is None

        for _ in range(100):
            if engine.state == "ready" and engine.start_count == 2:
                break
            await asyncio.sleep(0.02)
        assert engine.state == "ready"
        assert engine.start_count == 2
        assert engine.restart_count == 1
        assert reader_start_count == 2
    finally:
        await engine.stop()


@pytest.mark.asyncio
async def test_reader_failure_during_startup_is_reaped_without_restart_or_leak(
    fake_settings, monkeypatch
):
    engine = KataGomoEngine(fake_settings, restart_limit=1)
    spawned_processes = []

    async def fail_during_startup(process, generation):
        spawned_processes.append(process)
        raise RuntimeError("synthetic startup stdout failure")

    monkeypatch.setattr(engine, "_read_stdout", fail_during_startup)

    with pytest.raises(
        EngineUnavailableError, match="synthetic startup stdout failure"
    ):
        await engine.start()
    await asyncio.sleep(0)

    assert len(spawned_processes) == 1
    assert spawned_processes[0].returncode is not None
    assert engine.process is None
    assert engine.active is None
    assert engine.state == "error"
    assert engine.start_count == 1
    assert engine.restart_count == 0
    assert not engine._tasks
    assert not engine._task_generations


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("mode", "message_fragment"),
    [
        ("eof", "stdout closed unexpectedly"),
        ("malformed", "Invalid JSON"),
        ("truncated", "Truncated JSONL"),
    ],
)
async def test_broken_stdout_releases_request_and_restarts_once(
    fake_settings, tmp_path, mode, message_fragment
):
    settings = settings_with_broken_stdout(fake_settings, tmp_path, mode)
    engine = KataGomoEngine(settings, restart_limit=1)
    queue = asyncio.Queue()
    recovery_queue = asyncio.Queue()
    await engine.start()
    try:
        await engine.submit(
            moves=[], max_visits=6, report_during_search_every=0.5,
            user_color="B", client_request_id=f"broken-{mode}",
            output_queue=queue,
        )
        error = await next_of_type(queue, "error")
        assert error["code"] == "engine_background_error"
        assert error["clientRequestId"] == f"broken-{mode}"
        assert error["backgroundTask"] == "stdout reader"
        assert error["restartAttempted"] is True
        assert message_fragment in error["message"]
        assert engine.active is None

        for _ in range(100):
            if engine.state == "ready" and engine.start_count == 2:
                break
            await asyncio.sleep(0.02)
        assert engine.state == "ready"
        assert engine.start_count == 2
        assert engine.restart_count == 1

        await engine.submit(
            moves=[], max_visits=42, report_during_search_every=0.5,
            user_color="B", client_request_id=f"after-{mode}",
            output_queue=recovery_queue,
        )
        final = await next_of_type(recovery_queue, "analysis")
        while not final["isFinal"]:
            final = await next_of_type(recovery_queue, "analysis")
        assert final["clientRequestId"] == f"after-{mode}"
    finally:
        await engine.stop()


@pytest.mark.asyncio
async def test_analyzing_status_precedes_even_an_immediate_final(fake_settings):
    engine = KataGomoEngine(fake_settings)
    await engine.start()
    queue = asyncio.Queue()
    try:
        await engine.submit(
            moves=[], max_visits=42, report_during_search_every=0.5,
            user_color="B", client_request_id="fast-final", output_queue=queue,
            analysis_purpose="user_pre", position_revision=3,
            session_epoch="epoch-1",
        )
        first = await asyncio.wait_for(queue.get(), timeout=5)
        assert first["type"] == "status"
        assert first["status"] == "analyzing"
        assert first["analysisPurpose"] == "user_pre"
        assert first["positionRevision"] == 3
        assert first["sessionEpoch"] == "epoch-1"

        final = await next_of_type(queue, "analysis")
        while not final["isFinal"]:
            final = await next_of_type(queue, "analysis")
        assert final["requestedMaxVisits"] == 42
        assert final["positionMoveCount"] == 0
    finally:
        await engine.stop()
