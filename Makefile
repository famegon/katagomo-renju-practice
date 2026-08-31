.PHONY: setup venv source engine model verify-model smoke benchmark benchmark-threads

setup:
	@echo "Installing the minimal native CPU build and smoke-test dependencies: CMake, Eigen, and jq."
	brew install cmake eigen jq
	$(MAKE) venv

venv:
	@python3 -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11 or newer is required"'
	@if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
	@.venv/bin/python -c 'import sys; assert sys.version_info >= (3, 11); print(sys.version)'

source:
	./scripts/fetch-engine.sh

engine:
	./scripts/build-engine.sh

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
