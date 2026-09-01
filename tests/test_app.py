import platform
import sys
import time
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import server.app as app_module
from server.app import create_app
from server.config import PROJECT_ROOT


BLACK_LINE_WIN = [
    ["B", "D8"],
    ["W", "A1"],
    ["B", "E8"],
    ["W", "C1"],
    ["B", "F8"],
    ["W", "E1"],
    ["B", "G8"],
    ["W", "G1"],
    ["B", "H8"],
]


def with_official_position_helper(settings):
    return replace(
        settings,
        forbidden_helper_path=(
            PROJECT_ROOT / "build/forbidden-helper/forbidden_helper"
        ),
    )


def wait_for_analysis_session(
    client: TestClient, *, occupied: bool, attempts: int = 50
) -> dict:
    for _ in range(attempts):
        status = client.get("/api/status").json()
        if status["analysisSessionOccupied"] is occupied:
            return status
        time.sleep(0.01)
    raise AssertionError(f"analysisSessionOccupied did not become {occupied}")


def test_lifespan_stops_engine_when_startup_fails(fake_settings, monkeypatch):
    stopped = False

    class FailingStartupEngine:
        def __init__(self, _settings):
            pass

        async def start(self):
            raise RuntimeError("synthetic startup failure")

        async def stop(self):
            nonlocal stopped
            stopped = True

    monkeypatch.setattr(app_module, "KataGomoEngine", FailingStartupEngine)
    with pytest.raises(RuntimeError, match="synthetic startup failure"):
        with TestClient(app_module.create_app(fake_settings)):
            pass
    assert stopped is True


def test_fastapi_websocket_stream_on_supported_python(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        status = client.get("/api/status")
        assert status.status_code == 200
        assert status.json()["engine"]["state"] == "ready"
        assert sys.version_info >= (3, 11)
        assert status.json()["python"]["version"] == platform.python_version()

        with client.websocket_connect("/ws/analysis") as websocket:
            assert websocket.receive_json()["status"] == "connected"
            websocket.send_json(
                {
                    "action": "analyze",
                    "moves": [["B", "H8"], ["W", "H9"]],
                    "maxVisits": 42,
                    "userColor": "W",
                    "clientRequestId": "websocket-test",
                    "analysisPurpose": "user_pre",
                    "positionRevision": 7,
                    "sessionEpoch": "session-test",
                }
            )
            final = None
            for _ in range(10):
                message = websocket.receive_json()
                if message.get("type") == "analysis" and message.get("isFinal"):
                    final = message
                    break
            assert final is not None
            assert final["clientRequestId"] == "websocket-test"
            assert final["analysisPurpose"] == "user_pre"
            assert final["positionRevision"] == 7
            assert final["sessionEpoch"] == "session-test"
            assert final["requestedMaxVisits"] == 42
            assert final["positionMoveCount"] == 2
            assert final["policyLength"] == 226
            assert final["candidates"][0]["rawPrior"] == 0.6


def test_comparison_analyses_complete_sequentially_with_shared_identity(
    fake_settings,
):
    base_moves = [
        ["B", "H8"],
        ["W", "G7"],
        ["B", "G9"],
        ["W", "J7"],
    ]
    base_revision = len(base_moves)
    comparison_epoch = "comparison:fake-websocket-sequence"
    max_visits = 42
    requests = [
        ("comparison_base", "comparison-base", base_moves),
        (
            "comparison_a",
            "comparison-a",
            [*base_moves, ["B", "F9"]],
        ),
        (
            "comparison_b",
            "comparison-b",
            [*base_moves, ["B", "H6"]],
        ),
    ]

    with TestClient(create_app(fake_settings)) as client:
        with client.websocket_connect("/ws/analysis") as websocket:
            assert websocket.receive_json()["status"] == "connected"
            completed: list[str] = []

            for purpose, client_request_id, moves in requests:
                # A new comparison leg is deliberately not submitted until the
                # preceding leg's final response has been received and checked.
                expected_completed = [
                    request[1] for request in requests[: len(completed)]
                ]
                assert completed == expected_completed
                websocket.send_json(
                    {
                        "action": "analyze",
                        "moves": moves,
                        "maxVisits": max_visits,
                        "userColor": "B",
                        "clientRequestId": client_request_id,
                        "analysisPurpose": purpose,
                        "positionRevision": base_revision,
                        "sessionEpoch": comparison_epoch,
                    }
                )

                analyzing = websocket.receive_json()
                assert analyzing["type"] == "status"
                assert analyzing["status"] == "analyzing"
                assert analyzing["clientRequestId"] == client_request_id
                assert analyzing["analysisPurpose"] == purpose
                assert analyzing["positionRevision"] == base_revision
                assert analyzing["sessionEpoch"] == comparison_epoch
                assert analyzing["requestedMaxVisits"] == max_visits
                assert analyzing["positionMoveCount"] == len(moves)

                partial = websocket.receive_json()
                final = websocket.receive_json()
                for response in (partial, final):
                    assert response["type"] == "analysis"
                    assert response["clientRequestId"] == client_request_id
                    assert response["analysisPurpose"] == purpose
                    assert response["positionRevision"] == base_revision
                    assert response["sessionEpoch"] == comparison_epoch
                    assert response["requestedMaxVisits"] == max_visits
                    assert response["positionMoveCount"] == len(moves)
                    assert response["turnNumber"] == len(moves)

                assert partial["isDuringSearch"] is True
                assert partial["isFinal"] is False
                assert final["isDuringSearch"] is False
                assert final["isFinal"] is True
                completed.append(final["clientRequestId"])

            assert completed == ["comparison-base", "comparison-a", "comparison-b"]
            assert client.get("/api/status").json()["engine"]["startCount"] == 1


def test_local_ui_assets_disable_browser_cache(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        index = client.get("/")
        script = client.get("/static/app.js")

        assert index.status_code == 200
        assert script.status_code == 200
        assert index.headers["cache-control"] == "no-store"
        assert script.headers["cache-control"] == "no-store"


def test_http_accepts_only_exact_loopback_hosts_and_dynamic_ports(fake_settings):
    allowed_hosts = [
        "localhost",
        "localhost:43123",
        "127.0.0.1:51234",
        "[::1]:62000",
    ]
    with TestClient(create_app(fake_settings)) as client:
        for host in allowed_hosts:
            response = client.get("/api/status", headers={"host": host})
            assert response.status_code == 200, host


def test_http_rejects_dns_rebinding_and_malformed_hosts(fake_settings):
    hostile_hosts = [
        "attacker.example",
        "localhost.attacker.example",
        "127.0.0.1.attacker.example",
        "localhost@attacker.example",
        "localhost:0",
        "localhost:65536",
    ]
    with TestClient(create_app(fake_settings)) as client:
        for host in hostile_hosts:
            response = client.get("/api/status", headers={"host": host})
            assert response.status_code == 400, host
            assert response.text == "Invalid host header"


def test_testserver_host_is_limited_to_starlette_in_memory_peer(fake_settings):
    with TestClient(create_app(fake_settings)) as in_memory_client:
        assert in_memory_client.get("/api/status").status_code == 200

    with TestClient(
        create_app(fake_settings), client=("203.0.113.10", 43123)
    ) as non_test_peer:
        response = non_test_peer.get(
            "/api/status", headers={"host": "testserver"}
        )
        assert response.status_code == 400


def test_websocket_allows_originless_loopback_cli_client(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        with client.websocket_connect(
            "/ws/analysis", headers={"host": "127.0.0.1:51234"}
        ) as websocket:
            assert websocket.receive_json()["status"] == "connected"


@pytest.mark.parametrize(
    ("host", "origin"),
    [
        ("localhost:43123", "http://localhost:43123"),
        ("127.0.0.1:51234", "http://127.0.0.1:51234"),
        ("[::1]:62000", "http://[::1]:62000"),
    ],
)
def test_websocket_accepts_same_loopback_origin_with_dynamic_port(
    fake_settings, host, origin
):
    with TestClient(create_app(fake_settings)) as client:
        with client.websocket_connect(
            "/ws/analysis", headers={"host": host, "origin": origin}
        ) as websocket:
            assert websocket.receive_json()["status"] == "connected"


@pytest.mark.parametrize(
    "origin",
    [
        "https://attacker.example",
        "http://localhost.attacker.example:43123",
        "http://127.0.0.1:43123",
        "http://localhost:43124",
        "https://localhost:43123",
        "null",
    ],
)
def test_websocket_rejects_hostile_cross_host_and_cross_port_origins(
    fake_settings, origin
):
    with TestClient(create_app(fake_settings)) as client:
        with pytest.raises(WebSocketDisconnect) as rejected:
            with client.websocket_connect(
                "/ws/analysis",
                headers={"host": "localhost:43123", "origin": origin},
            ):
                pass
        assert rejected.value.code == 1008


def test_websocket_rejects_hostile_host_even_without_origin(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        with pytest.raises(WebSocketDisconnect) as rejected:
            with client.websocket_connect(
                "/ws/analysis", headers={"host": "localhost.attacker.example"}
            ):
                pass
        assert rejected.value.code == 1008


def test_position_endpoint_uses_official_board_history(fake_settings):
    settings = with_official_position_helper(fake_settings)
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/position",
            json={"moves": BLACK_LINE_WIN, "nextPlayer": "W"},
        )
        assert response.status_code == 200
        state = response.json()
        assert state["rules"] == "renju"
        assert state["isTerminal"] is True
        assert state["winner"] == "B"
        assert state["outcome"] == "black_win"
        assert state["terminalReason"] == "line_win"
        assert state["terminalMove"] == "H8"
        assert state["legalMoves"] == []
        assert state["forbiddenMoves"] == []
        assert state["historySource"].startswith("KataGomo BoardHistory")


def test_terminal_position_is_not_sent_to_analysis_engine(fake_settings):
    settings = with_official_position_helper(fake_settings)
    with TestClient(create_app(settings)) as client:
        with client.websocket_connect("/ws/analysis") as websocket:
            assert websocket.receive_json()["status"] == "connected"
            websocket.send_json(
                {
                    "action": "analyze",
                    "moves": BLACK_LINE_WIN,
                    "maxVisits": 500,
                    "clientRequestId": "terminal-comparison-a",
                    "analysisPurpose": "comparison_a",
                    "positionRevision": len(BLACK_LINE_WIN) - 1,
                    "sessionEpoch": "comparison:terminal",
                }
            )
            terminal = websocket.receive_json()
            assert terminal["type"] == "position"
            assert terminal["code"] == "position_terminal"
            assert terminal["clientRequestId"] == "terminal-comparison-a"
            assert terminal["analysisPurpose"] == "comparison_a"
            assert terminal["positionRevision"] == len(BLACK_LINE_WIN) - 1
            assert terminal["sessionEpoch"] == "comparison:terminal"
            assert terminal["requestedMaxVisits"] == 500
            assert terminal["positionMoveCount"] == len(BLACK_LINE_WIN)
            assert terminal["gameState"]["winner"] == "B"
            assert terminal["gameState"]["terminalReason"] == "line_win"
            status = client.get("/api/status").json()
            assert status["analysisSessionOccupied"] is False
            assert status["engine"]["state"] == "ready"
            assert status["engine"]["activeRequestId"] is None

            websocket.send_json(
                {
                    "action": "analyze",
                    "moves": [],
                    "maxVisits": 42,
                    "clientRequestId": "after-terminal-rejection",
                }
            )
            assert websocket.receive_json()["status"] == "analyzing"
            while True:
                message = websocket.receive_json()
                if message.get("type") == "analysis" and message.get("isFinal"):
                    break
            assert message["clientRequestId"] == "after-terminal-rejection"


def test_terminal_position_supersedes_active_search_and_releases_lease(
    fake_settings,
):
    settings = with_official_position_helper(fake_settings)
    with TestClient(create_app(settings)) as client:
        with client.websocket_connect("/ws/analysis") as websocket:
            assert websocket.receive_json()["status"] == "connected"
            websocket.send_json(
                {
                    "action": "analyze",
                    "moves": [],
                    "maxVisits": 100,
                    "clientRequestId": "obsolete-search",
                }
            )
            assert websocket.receive_json()["status"] == "analyzing"
            assert websocket.receive_json()["isDuringSearch"] is True
            assert wait_for_analysis_session(client, occupied=True)

            websocket.send_json(
                {
                    "action": "analyze",
                    "moves": BLACK_LINE_WIN,
                    "clientRequestId": "terminal-replacement",
                    "positionRevision": len(BLACK_LINE_WIN),
                }
            )
            messages = [websocket.receive_json(), websocket.receive_json()]
            terminal = next(
                message for message in messages if message.get("type") == "position"
            )
            canceled = next(
                message
                for message in messages
                if message.get("type") == "status"
                and message.get("status") == "canceled"
            )
            assert terminal["clientRequestId"] == "terminal-replacement"
            assert terminal["gameState"]["outcome"] == "black_win"
            assert canceled["clientRequestId"] == "obsolete-search"
            assert wait_for_analysis_session(client, occupied=False)


def test_position_endpoint_rejects_moves_after_terminal(fake_settings):
    settings = with_official_position_helper(fake_settings)
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/position",
            json={
                "moves": [*BLACK_LINE_WIN, ["W", "P15"]],
                "nextPlayer": "B",
            },
        )
        assert response.status_code == 422
        assert "after the game ended" in response.json()["detail"]


def test_position_endpoint_reports_unstartable_helper_as_service_unavailable(
    fake_settings,
):
    fake_settings.forbidden_helper_path.chmod(0o644)
    with TestClient(create_app(fake_settings)) as client:
        response = client.post("/api/position", json={"moves": []})
        assert response.status_code == 503
        assert "Could not start the Renju position helper" in response.json()["detail"]


def test_multiple_idle_websockets_share_one_active_analysis_session(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        with client.websocket_connect("/ws/analysis") as first:
            assert first.receive_json()["status"] == "connected"
            with client.websocket_connect("/ws/analysis") as second:
                assert second.receive_json()["status"] == "connected"

                idle_status = client.get("/api/status").json()
                assert idle_status["analysisConnectionCount"] == 2
                assert idle_status["analysisSessionOccupied"] is False

                first.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 100,
                        "clientRequestId": "first-long",
                    }
                )
                assert first.receive_json()["status"] == "analyzing"
                during = first.receive_json()
                assert during["type"] == "analysis"
                assert during["isDuringSearch"] is True

                active_status = client.get("/api/status").json()
                assert active_status["analysisConnectionCount"] == 2
                assert active_status["analysisSessionOccupied"] is True

                second.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 42,
                        "clientRequestId": "second-busy",
                    }
                )
                busy = second.receive_json()
                assert busy["type"] == "error"
                assert busy["code"] == "session_busy"
                assert busy["clientRequestId"] == "second-busy"

                first.send_json({"action": "cancel"})
                canceled = first.receive_json()
                assert canceled["status"] == "canceled"
                assert canceled["clientRequestId"] == "first-long"

                second.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 42,
                        "clientRequestId": "second-retry",
                    }
                )
                assert second.receive_json()["status"] == "analyzing"
                while True:
                    message = second.receive_json()
                    if message.get("type") == "analysis" and message.get("isFinal"):
                        break
                assert message["clientRequestId"] == "second-retry"
                released = wait_for_analysis_session(client, occupied=False)
                assert released["analysisConnectionCount"] == 2

                first.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 42,
                        "clientRequestId": "first-after-final",
                    }
                )
                assert first.receive_json()["status"] == "analyzing"
                while True:
                    message = first.receive_json()
                    if message.get("type") == "analysis" and message.get("isFinal"):
                        break
                assert message["clientRequestId"] == "first-after-final"


def test_superseded_response_cannot_release_new_request_lease(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        with client.websocket_connect("/ws/analysis") as owner:
            assert owner.receive_json()["status"] == "connected"
            with client.websocket_connect("/ws/analysis") as observer:
                assert observer.receive_json()["status"] == "connected"

                owner.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 100,
                        "clientRequestId": "old-request",
                    }
                )
                assert owner.receive_json()["status"] == "analyzing"
                assert owner.receive_json()["isDuringSearch"] is True

                owner.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 100,
                        "clientRequestId": "new-request",
                    }
                )
                canceled = owner.receive_json()
                assert canceled["status"] == "canceled"
                assert canceled["clientRequestId"] == "old-request"
                assert owner.receive_json()["clientRequestId"] == "new-request"
                replacement_during = owner.receive_json()
                assert replacement_during["clientRequestId"] == "new-request"
                assert replacement_during["isDuringSearch"] is True

                observer.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 42,
                        "clientRequestId": "must-stay-busy",
                    }
                )
                busy = observer.receive_json()
                assert busy["code"] == "session_busy"
                assert busy["clientRequestId"] == "must-stay-busy"

                owner.send_json({"action": "cancel"})


def test_engine_warning_keeps_request_lease_until_terminal_event(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        with client.websocket_connect("/ws/analysis") as owner:
            assert owner.receive_json()["status"] == "connected"
            with client.websocket_connect("/ws/analysis") as observer:
                assert observer.receive_json()["status"] == "connected"

                owner.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 6,
                        "clientRequestId": "warning-owner",
                    }
                )
                assert owner.receive_json()["status"] == "analyzing"
                warning = owner.receive_json()
                assert warning["type"] == "warning"
                assert warning["clientRequestId"] == "warning-owner"

                observer.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 42,
                        "clientRequestId": "blocked-by-warning-request",
                    }
                )
                busy = observer.receive_json()
                assert busy["code"] == "session_busy"
                assert busy["clientRequestId"] == "blocked-by-warning-request"

                owner.send_json({"action": "cancel"})
                canceled = owner.receive_json()
                assert canceled["status"] == "canceled"
                assert canceled["clientRequestId"] == "warning-owner"


def test_terminal_engine_error_releases_lease_for_another_socket(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        with client.websocket_connect("/ws/analysis") as owner:
            assert owner.receive_json()["status"] == "connected"
            with client.websocket_connect("/ws/analysis") as observer:
                assert observer.receive_json()["status"] == "connected"
                owner.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 7,
                        "clientRequestId": "bad-policy-owner",
                    }
                )
                assert owner.receive_json()["status"] == "analyzing"
                error = owner.receive_json()
                assert error["code"] == "engine_protocol_error"
                assert error["clientRequestId"] == "bad-policy-owner"
                wait_for_analysis_session(client, occupied=False)

                observer.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 42,
                        "clientRequestId": "observer-after-error",
                    }
                )
                assert observer.receive_json()["status"] == "analyzing"
                while True:
                    response = observer.receive_json()
                    if response.get("type") == "analysis" and response.get("isFinal"):
                        break
                assert response["clientRequestId"] == "observer-after-error"


def test_validation_error_does_not_release_active_request_lease(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        with client.websocket_connect("/ws/analysis") as owner:
            assert owner.receive_json()["status"] == "connected"
            with client.websocket_connect("/ws/analysis") as observer:
                assert observer.receive_json()["status"] == "connected"
                owner.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 100,
                        "clientRequestId": "valid-active",
                    }
                )
                assert owner.receive_json()["status"] == "analyzing"
                assert owner.receive_json()["isDuringSearch"] is True

                owner.send_json(
                    {
                        "action": "analyze",
                        "moves": [["W", "H8"]],
                        "clientRequestId": "invalid-while-active",
                    }
                )
                validation = owner.receive_json()
                assert validation["code"] == "validation_error"
                assert validation["clientRequestId"] == "invalid-while-active"
                assert wait_for_analysis_session(client, occupied=True)

                observer.send_json(
                    {
                        "action": "analyze",
                        "moves": [],
                        "maxVisits": 42,
                        "clientRequestId": "observer-still-blocked",
                    }
                )
                busy = observer.receive_json()
                assert busy["code"] == "session_busy"
                owner.send_json({"action": "cancel"})
                assert owner.receive_json()["status"] == "canceled"


def test_websocket_validation_error_is_json_and_connection_stays_usable(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        with client.websocket_connect("/ws/analysis") as websocket:
            assert websocket.receive_json()["status"] == "connected"
            websocket.send_json(
                {"action": "analyze", "moves": [["W", "H8"]]}
            )
            error = websocket.receive_json()
            assert error["type"] == "error"
            assert error["code"] == "validation_error"
            assert error["details"]

            websocket.send_text(
                '{"action":"analyze","moves":[],"maxVisits":Infinity}'
            )
            nonfinite_error = websocket.receive_json()
            assert nonfinite_error["code"] == "validation_error"
            assert nonfinite_error["details"][0]["input"] == "inf"

            websocket.send_json(
                {
                    "action": "analyze",
                    "moves": [],
                    "maxVisits": 42,
                    "clientRequestId": "after-validation-error",
                }
            )
            while True:
                response = websocket.receive_json()
                if response.get("type") == "analysis" and response.get("isFinal"):
                    break
            assert response["clientRequestId"] == "after-validation-error"


def test_rest_validation_error_with_nonfinite_input_remains_json(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        response = client.post(
            "/api/training/evaluate",
            content='{"ply":Infinity}',
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422
        body = response.json()
        assert isinstance(body["detail"], list)
        assert any(error.get("input") == "inf" for error in body["detail"])
