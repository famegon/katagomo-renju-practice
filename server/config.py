from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True, slots=True)
class Settings:
    engine_path: Path
    model_path: Path
    analysis_config_path: Path
    forbidden_helper_path: Path
    engine_stderr_path: Path

    @classmethod
    def from_environment(cls) -> "Settings":
        return cls(
            engine_path=Path(
                os.environ.get(
                    "KATAGOMO_ENGINE",
                    PROJECT_ROOT / "build/engine-eigen/katago",
                )
            ),
            model_path=Path(
                os.environ.get(
                    "KATAGOMO_MODEL",
                    PROJECT_ROOT / "models/zhizi_renju28b_s1600.bin.gz",
                )
            ),
            analysis_config_path=Path(
                os.environ.get(
                    "KATAGOMO_ANALYSIS_CONFIG",
                    PROJECT_ROOT / "config/analysis.cfg",
                )
            ),
            forbidden_helper_path=Path(
                os.environ.get(
                    "KATAGOMO_FORBIDDEN_HELPER",
                    PROJECT_ROOT / "build/forbidden-helper/forbidden_helper",
                )
            ),
            engine_stderr_path=Path(
                os.environ.get(
                    "KATAGOMO_ENGINE_LOG",
                    PROJECT_ROOT / "artifacts/stage2/engine-stderr.log",
                )
            ),
        )

