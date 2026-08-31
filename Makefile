.PHONY: setup venv python-deps source engine opencl model verify-model smoke benchmark benchmark-threads forbidden-helper dev test integration-test compare-visits websocket-smoke

setup:
	@echo "Installing the minimal native CPU build and smoke-test dependencies: CMake, Eigen, and jq."
	brew install cmake eigen jq
	$(MAKE) venv
	$(MAKE) python-deps

venv:
	@python3 -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11 or newer is required"'
	@if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
	@.venv/bin/python -c 'import sys; assert sys.version_info >= (3, 11); print(sys.version)'

python-deps: venv
	.venv/bin/python -m pip install -r requirements-dev.txt

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

test: forbidden-helper
	.venv/bin/python -m pytest -m 'not integration'

integration-test:
	KATAGOMO_RUN_INTEGRATION=1 .venv/bin/python -m pytest -m integration

compare-visits:
	.venv/bin/python scripts/compare-visits.py

websocket-smoke:
	.venv/bin/python scripts/websocket-smoke.py
