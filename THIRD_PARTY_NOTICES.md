# Third-party notices

This repository contains the local server, browser UI, build adapters, and
tests for KataGomo Renju Practice. It does not commit or redistribute the
KataGomo engine checkout, compiled binaries, or neural-network weights.

## KataGomo

The setup scripts fetch the official
[`hzyhhzy/KataGomo`](https://github.com/hzyhhzy/KataGomo) repository at the
recorded `Gom2024` commit. KataGomo is derived from KataGo and is distributed
under the license and third-party notices in its own repository. The fetched
checkout remains unmodified and keeps its original `LICENSE`, `CONTRIBUTORS`,
and licenses under `cpp/external/`.

## Renju neural-network model

The model is not part of this Git repository. `make model` downloads
`zhizi_renju28b_s1600.bin.gz` directly from the official KataGomo
`Gomoku_20250206` release, verifies its recorded byte size and SHA-256, and
stores it only in the ignored local `models/` directory. See
`models/MANIFEST.json` for the source URL and integrity metadata. Users remain
responsible for following the upstream release terms when using the model.

## Python and JavaScript dependencies

Python packages are installed into the ignored project `.venv` from
`requirements-lock.txt`. No third-party browser package or generated bundle is
committed. Each dependency retains its own license.

KataGomo, KataGo, and the model authors are not affiliated with or responsible
for this user interface.
