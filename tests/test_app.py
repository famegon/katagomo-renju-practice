from fastapi.testclient import TestClient

from server.app import create_app


def test_fastapi_websocket_stream_on_python_314(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        status = client.get("/api/status")
        assert status.status_code == 200
        assert status.json()["engine"]["state"] == "ready"
        assert status.json()["python"]["version"] == "3.14.6"

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


def test_fastapi_rejects_second_analysis_session(fake_settings):
    with TestClient(create_app(fake_settings)) as client:
        with client.websocket_connect("/ws/analysis") as first:
            assert first.receive_json()["status"] == "connected"
            with client.websocket_connect("/ws/analysis") as second:
                message = second.receive_json()
                assert message["type"] == "error"
                assert message["code"] == "session_busy"

            status = client.get("/api/status").json()
            assert status["analysisSessionOccupied"] is True


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
