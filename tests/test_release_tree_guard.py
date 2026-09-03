from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
GUARD_SOURCE = PROJECT_ROOT / "scripts" / "check-release-tree.sh"


def _run(*args: str, cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=cwd,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


def _repo(tmp_path: Path, files: dict[str, bytes | str]) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    assert _run("git", "init", "--quiet", cwd=repo).returncode == 0

    guard = repo / "scripts" / "check-release-tree.sh"
    guard.parent.mkdir()
    shutil.copy2(GUARD_SOURCE, guard)
    guard.chmod(0o755)

    for relative_path, content in files.items():
        target = repo / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            target.write_bytes(content)
        else:
            target.write_text(content, encoding="utf-8")

    assert _run("git", "add", "--force", ".", cwd=repo).returncode == 0
    return repo


def _guard(repo: Path, *, max_bytes: int | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    if max_bytes is not None:
        env["RELEASE_GUARD_MAX_BYTES"] = str(max_bytes)
    return _run("./scripts/check-release-tree.sh", cwd=repo, env=env)


def _commit(repo: Path, message: str) -> None:
    assert _run("git", "config", "user.name", "Release Guard Test", cwd=repo).returncode == 0
    assert _run(
        "git", "config", "user.email", "release-guard@example.invalid", cwd=repo
    ).returncode == 0
    result = _run("git", "commit", "--quiet", "-m", message, cwd=repo)
    assert result.returncode == 0, result.stderr


def test_release_guard_allows_expected_model_metadata(tmp_path: Path) -> None:
    repo = _repo(
        tmp_path,
        {
            "models/.gitkeep": "",
            "models/MANIFEST.json": '{"model": "downloaded separately"}\n',
            ".env.example": "KATAGOMO_MODEL_PATH=models/example.bin.gz\n",
            "src/app.py": "print('safe')\n",
        },
    )

    result = _guard(repo)

    assert result.returncode == 0, result.stderr
    assert "release-tree guard: OK" in result.stdout


@pytest.mark.parametrize(
    "relative_path",
    [
        "models/weights.bin.gz",
        "vendor/KataGomo/cpp/CMakeLists.txt",
        "build/katago",
        "artifacts/stage1/engine.log",
        ".venv/pyvenv.cfg",
        ".env.local",
        "deploy/private-key.pem",
    ],
)
def test_release_guard_rejects_non_distributable_paths(
    tmp_path: Path, relative_path: str
) -> None:
    repo = _repo(tmp_path, {relative_path: "must not ship\n"})

    result = _guard(repo)

    assert result.returncode == 1
    assert relative_path in result.stderr
    assert "FAILED" in result.stderr


def test_release_guard_rejects_large_tracked_blob(tmp_path: Path) -> None:
    repo = _repo(tmp_path, {"unexpected.bin": b"x" * 65_537})

    result = _guard(repo, max_bytes=65_536)

    assert result.returncode == 1
    assert "tracked blob exceeds 65536 bytes" in result.stderr
    assert "unexpected.bin" in result.stderr


def test_release_guard_rejects_high_confidence_secret_shape(tmp_path: Path) -> None:
    fake_access_key = "AK" + "IA" + ("A" * 16)
    repo = _repo(tmp_path, {"config.txt": f"access_key={fake_access_key}\n"})

    result = _guard(repo)

    assert result.returncode == 1
    assert "possible embedded credential detected: config.txt" in result.stderr
    assert fake_access_key not in result.stderr


def test_release_guard_rejects_forbidden_path_deleted_from_current_tree(tmp_path: Path) -> None:
    repo = _repo(tmp_path, {"models/weights.bin.gz": "historical model\n"})
    _commit(repo, "add forbidden model")
    (repo / "models" / "weights.bin.gz").unlink()
    assert _run("git", "add", "--update", cwd=repo).returncode == 0
    _commit(repo, "delete forbidden model")

    result = _guard(repo)

    assert result.returncode == 1
    assert "reachable history contains forbidden path" in result.stderr
    assert "models/weights.bin.gz" in result.stderr


def test_release_guard_rejects_large_blob_deleted_from_current_tree(tmp_path: Path) -> None:
    repo = _repo(tmp_path, {"historical-large.bin": b"x" * 65_537})
    _commit(repo, "add oversized file")
    (repo / "historical-large.bin").unlink()
    assert _run("git", "add", "--update", cwd=repo).returncode == 0
    _commit(repo, "delete oversized file")

    result = _guard(repo, max_bytes=65_536)

    assert result.returncode == 1
    assert "reachable history contains blob over 65536 bytes" in result.stderr
    assert "historical-large.bin" in result.stderr
