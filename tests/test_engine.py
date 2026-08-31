from __future__ import annotations

import asyncio

import pytest

from server.engine import KataGomoEngine


async def next_of_type(queue, event_type):
    while True:
        value = await asyncio.wait_for(queue.get(), timeout=5)
        if value.get("type") == event_type:
            return value


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
