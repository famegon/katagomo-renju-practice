# Third-party notices

This repository contains the local server, browser UI, build adapters, and
tests for KataGomo Renju Practice. It does not commit or redistribute the
KataGomo engine checkout, compiled binaries, or neural-network weights.

## KataGomo

The setup scripts fetch the official
[`hzyhhzy/KataGomo`](https://github.com/hzyhhzy/KataGomo) repository at the
immutable commit
[`df152116e3787c75c6a3de099d261ca092b7dfc1`](https://github.com/hzyhhzy/KataGomo/commit/df152116e3787c75c6a3de099d261ca092b7dfc1)
from the `Gom2024` branch. Its license at that revision is available at this
[immutable license link](https://github.com/hzyhhzy/KataGomo/blob/df152116e3787c75c6a3de099d261ca092b7dfc1/LICENSE).
KataGomo is derived from KataGo and is distributed under the license and
third-party notices in its own repository. The fetched checkout remains
unmodified and keeps its original `LICENSE`, `CONTRIBUTORS`, and licenses under
`cpp/external/`.

## Renju neural-network model

The model is not part of this Git repository. `make model` downloads
`zhizi_renju28b_s1600.bin.gz` directly from the official KataGomo
[`Gomoku_20250206` release](https://github.com/hzyhhzy/KataGomo/releases/tag/Gomoku_20250206),
verifies its recorded size of `269873929` bytes and SHA-256
`5aa1381aa37ba1b724469c5c8df3b59177079f5c57b355856e144b8146581f6f`, and
stores it only in the ignored local `models/` directory. GitHub did not publish
a digest for this release asset; the recorded SHA-256 was computed locally
after downloading the official asset and is used as an integrity check, not as
proof of licensing or authorship. See `models/MANIFEST.json` for the source URL
and complete integrity metadata.

As checked on 2026-09-03, the referenced release page describes the model asset
but does not state a separate license for the neural-network weights. Users
remain responsible for following the upstream release terms. The engine
reports its model name as
`zhizigo_renju28b-b28c512nbt-s1617930240-d2051476833`. This project therefore
does not redistribute or bundle that asset and does not grant any additional
right to use or redistribute it.

## Python and JavaScript dependencies

Python packages are installed into the ignored project `.venv` from
`requirements-lock.txt`. No third-party browser package or generated bundle is
committed. Each dependency retains its own license.

The repository-level MIT license applies only to this project's original local
server, browser UI, adapters, documentation, and tests. KataGomo, KataGo, the
model, and all other dependencies remain subject to their respective upstream
licenses or terms. The combined checkout is therefore a composite work and is
not relicensed as a whole by this project.

This is an unofficial community interface. KataGomo, KataGo, and the model
authors are not affiliated with, responsible for, or endorsing this project.
