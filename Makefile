.PHONY: bootstrap doctor setup venv python-deps source engine opencl model verify-model smoke benchmark benchmark-threads forbidden-helper dev release-check test integration-test compare-visits websocket-smoke

bootstrap: doctor setup engine model forbidden-helper smoke
	@echo "KataGomo Renju Practice is ready. Start it with: make dev"

doctor:
	./scripts/doctor.sh

setup:
	@echo "Installing the minimal native CPU build and smoke-test dependencies: CMake, Eigen, and jq."
	brew install cmake eigen jq
	$(MAKE) venv
	$(MAKE) python-deps

venv:
	@if [ ! -x .venv/bin/python ]; then \
		python3 -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11 or newer is required"'; \
		python3 -m venv .venv; \
	fi
	@.venv/bin/python -c 'import sys; assert sys.version_info >= (3, 11); print(sys.version)'

python-deps: venv
	.venv/bin/python -m pip install -r requirements-lock.txt

source:
	./scripts/fetch-engine.sh

engine:
	./scripts/build-engine.sh

opencl:
	./scripts/build-opencl-engine.sh

model:
	./scripts/download-model.sh

verify-model:
	./scripts/verify-model.sh

smoke:
	./scripts/smoke-analysis.sh

benchmark:
	./scripts/benchmark-cpu.sh

benchmark-threads:
	KATAGOMO_BENCH_MODE=threads ./scripts/benchmark-cpu.sh

forbidden-helper:
	./scripts/build-forbidden-helper.sh

dev:
	./scripts/dev.sh

release-check:
	./scripts/check-release-tree.sh

test: forbidden-helper release-check
	@test -x .venv/bin/python || { echo "Missing .venv. Run: make setup" >&2; exit 1; }
	@command -v node >/dev/null || { echo "Missing Node.js. Install Node 18 or newer for web tests." >&2; exit 1; }
	@node -e 'const major = Number(process.versions.node.split(".")[0]); if (major < 18) { console.error(`Node 18 or newer is required, got $${process.versions.node}`); process.exit(1); }'
	node --check web/app.js
	node --test tests/web_*.test.mjs
	.venv/bin/python -m pytest -m 'not integration'

integration-test: forbidden-helper verify-model
	@test -x .venv/bin/python || { echo "Missing .venv. Run: make setup" >&2; exit 1; }
	@test -x build/engine-eigen/katago || { echo "Missing CPU/Eigen engine. Run: make engine" >&2; exit 1; }
	KATAGOMO_RUN_INTEGRATION=1 .venv/bin/python -m pytest -m integration

compare-visits:
	.venv/bin/python scripts/compare-visits.py

websocket-smoke:
	.venv/bin/python scripts/websocket-smoke.py
