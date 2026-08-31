import pytest

from server.jsonlines import JsonLineBuffer


def test_json_lines_parsing():
    parser = JsonLineBuffer()
    assert parser.feed(b'{"id":1}\n{"id":2}\n') == [{"id": 1}, {"id": 2}]
    parser.finish()


def test_partial_json_stream_chunks():
    parser = JsonLineBuffer()
    assert parser.feed(b'{"id":"par') == []
    assert parser.feed(b'tial","ok":true}\r') == []
    assert parser.feed(b'\n{"id":"next"') == [{"id": "partial", "ok": True}]
    assert parser.feed(b'}\n') == [{"id": "next"}]
    parser.finish()


def test_incomplete_json_line_rejected_at_eof():
    parser = JsonLineBuffer()
    parser.feed(b'{"id":')
    with pytest.raises(ValueError, match="Incomplete"):
        parser.finish()

