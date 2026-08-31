# KataGomo 기반 오목 초반 연습 프로그램

현재는 **Stage 1 체크포인트, 제한된 Stage 1.5 OpenCL 검증, Stage 2 분석 서버 MVP와 진단 UI까지 완료**된 상태다. 공식 KataGomo `Gom2024` 소스와 공식 Renju `b28c512nbt` 모델만 사용한다. Apple M5에서 CPU/Eigen과 OpenCL 모두 실제 모델 로딩·15×15 Renju 분석을 통과했으며, FastAPI 서버가 한 개의 persistent analysis 프로세스를 관리하고 실제 중간/최종 JSON을 WebSocket으로 보낸다. 금수는 프로젝트가 재구현하지 않고 공식 `Board::isForbidden()`을 호출한다.

공식 기준 자료:

- [KataGomo 저장소 `Gom2024`](https://github.com/hzyhhzy/KataGomo/tree/Gom2024)
- [Gomoku_20250206 릴리스](https://github.com/hzyhhzy/KataGomo/releases/tag/Gomoku_20250206)
- [Analysis Engine 문서](https://github.com/hzyhhzy/KataGomo/blob/Gom2024/docs/Analysis_Engine.md)
- 사용 엔진 커밋: [`df152116e3787c75c6a3de099d261ca092b7dfc1`](https://github.com/hzyhhzy/KataGomo/commit/df152116e3787c75c6a3de099d261ca092b7dfc1)

## 확인한 Mac 환경

2026-08-31(KST)에 실제 명령으로 확인했다. 일련번호와 UUID 같은 장치 식별자는 기록하지 않았다.

| 항목 | 확인 결과 |
|---|---|
| 장치 | MacBook Pro (`Mac17,2`) |
| 아키텍처 | Apple Silicon, `arm64` |
| SoC / CPU | Apple M5, 10코어(성능 4 + 효율 6) |
| GPU | Apple M5 내장 GPU, 10코어; 시스템 Metal 지원 |
| 메모리 | 24 GB |
| macOS | 26.6.2, build `25G83`, Darwin `25.6.0` |
| Homebrew | 최초 확인 6.0.19, 패키지 설치 후 현재 6.0.20, `/opt/homebrew` |
| CMake | 최초 미설치 → Homebrew 4.4.3 설치 |
| C++ compiler | Apple Clang 21.0.0, ARM64 target |
| Command Line Tools | `/Library/Developer/CommandLineTools` |
| Eigen | 최초 미설치 → Homebrew 5.0.1 설치 |
| zlib | macOS SDK 1.2.12 사용 |
| libzip | 미설치; 분석/GTP에는 선택 사항 |
| Git | Apple Git 2.50.1 |
| Python | 기존 CPython 3.14.6 (`/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`) |
| 프로젝트 venv | `.venv`, CPython 3.14.6, pip 26.1.2, system site-packages 미사용 |
| Node / npm | Node 24.18.0 / npm 11.16.0 |
| jq | 1.8.2, 기존 설치됨; smoke JSON 계약 검증에 사용 |
| Ninja / pkg-config | 미설치; 이번 Makefile 빌드에는 불필요 |

네이티브 빌드를 위해 새로 설치한 것은 `cmake`(67.2 MB)와 `eigen`(10.2 MB)뿐이다. `jq`와 CPython 3.14.6은 이미 설치되어 있어 새 Python을 설치하지 않았다. 기존 `python3`로 프로젝트 전용 `.venv`를 만들고 Stage 2 의존성을 그 안에만 설치했다.

| Python 패키지 | 검증 버전 |
|---|---:|
| FastAPI | 0.141.1 |
| Uvicorn | 0.52.4 |
| websockets | 17.1 |
| Starlette | 1.6.0 |
| Pydantic | 2.13.5 |
| httpx2 | 2.12.0 |
| pytest / pytest-asyncio | 9.1.1 / 1.4.0 |

CPython 3.14.6에서 설치, import, 서버 기동, WebSocket, 테스트까지 실제로 통과했다. Python 호환성 문제는 발견되지 않았다.

## 빠른 재현

모든 명령은 이 README가 있는 프로젝트 루트에서 실행한다.

```bash
make setup       # cmake/eigen/jq + 기존 Python 3.11 이상 .venv와 Python 의존성
make engine      # 공식 커밋을 가져와 ARM64 CPU/Eigen 엔진 빌드
make opencl      # macOS OpenCL 엔진 빌드(이 Mac에서 실추론 검증됨)
make model       # 공식 모델 269,873,929바이트 다운로드 및 검증
make forbidden-helper # 공식 Board::isForbidden() 기반 helper 빌드
make smoke       # 실제 15x15 Renju JSONL 분석
make benchmark   # 8 threads, 100/500/1000 visits 순차 측정(약 2분)
make benchmark-threads # 100 visits에서 1/2/4/6/8/10 threads 비교
make dev         # persistent 엔진 + FastAPI + 진단 UI, http://127.0.0.1:8000
make test        # helper 포함 단위/프로세스/WebSocket 테스트
make integration-test # 실제 Eigen 엔진·실제 모델 통합 테스트
make compare-visits   # 실제 100/500 visits 후보 분포 기록
```

`make model`은 약 257 MiB를 받는다. 다른 릴리스 묶음이나 Windows 실행 파일은 받지 않는다. 기존 엔진 디렉터리의 커밋이 다르거나 기존 모델의 해시가 다르면 스크립트는 덮어쓰지 않고 중단한다.

현재 설치를 다시 확인하기만 하려면 다음으로 충분하다.

```bash
make verify-model
build/engine-eigen/katago version
make smoke
```

기본 경로를 바꿀 때는 다음 환경변수를 쓸 수 있다.

```bash
KATAGOMO_ENGINE=/absolute/path/to/katago \
KATAGOMO_MODEL=/absolute/path/to/zhizi_renju28b_s1600.bin.gz \
make smoke
```

`make dev`는 검증된 OpenCL 실행 파일이 있으면 이를 우선하고, 없으면 CPU/Eigen으로 내려간다. 종료는 실행 중인 터미널에서 `Ctrl-C`를 누른다. 서버가 끝날 때 analysis 자식 프로세스에도 terminate/EOF를 보내고 제한 시간 뒤에만 강제 종료한다.

CPU/Eigen을 명시적으로 선택하려면 두 경로를 함께 지정한다.

```bash
KATAGOMO_ENGINE="$PWD/build/engine-eigen/katago" \
KATAGOMO_ANALYSIS_CONFIG="$PWD/config/analysis.cfg" \
make dev
```

## 엔진 빌드 결과

빌드는 공식 소스를 수정하지 않은 out-of-source 방식이다.

```text
KataGo v1.12.4
Git revision: df152116e3787c75c6a3de099d261ca092b7dfc1
Using Eigen(CPU) backend
Compiled to allow boards of size up to 15
```

결과 실행 파일은 `build/engine-eigen/katago`이며 `Mach-O 64-bit executable arm64`로 확인했다. 동적 링크는 macOS의 `libz`, `libc++`, `libSystem`뿐이다.

재현용 핵심 CMake 옵션은 다음과 같다.

```bash
cmake -S vendor/KataGomo/cpp -B build/engine-eigen \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_BACKEND=EIGEN \
  -DUSE_AVX2=OFF \
  -DBUILD_DISTRIBUTED=OFF \
  -DUSE_TCMALLOC=OFF \
  -DEIGEN3_INCLUDE_DIRS="$(brew --prefix eigen)/include/eigen3"
cmake --build build/engine-eigen --parallel
```

Apple Silicon에는 AVX2가 없으므로 반드시 껐다. Homebrew Eigen 5의 CMake package가 이 오래된 CMakeLists의 `EIGEN3_INCLUDE_DIRS` 변수를 채우지 않아 include 경로를 명시했다.

### 백엔드 조사

고정 커밋의 [CMake 백엔드 목록](https://github.com/hzyhhzy/KataGomo/blob/df152116e3787c75c6a3de099d261ca092b7dfc1/cpp/CMakeLists.txt#L28-L100)은 `CUDA`, `TENSORRT`, `OPENCL`, `EIGEN`뿐이다.

- **Metal:** 이 `Gom2024` 소스에는 옵션도 구현 파일도 없다. Mac 시스템이 Metal을 지원한다는 사실과 KataGomo가 Metal을 지원한다는 것은 별개다.
- **OpenCL:** [OpenCL CMake 경로](https://github.com/hzyhhzy/KataGomo/blob/df152116e3787c75c6a3de099d261ca092b7dfc1/cpp/CMakeLists.txt#L328-L346)와 [Apple 전용 OpenCL 헤더 경로](https://github.com/hzyhhzy/KataGomo/blob/df152116e3787c75c6a3de099d261ca092b7dfc1/cpp/neuralnet/openclincludes.h#L4-L12)를 사용해 실제 Apple M5 GPU 열거, 모델 로딩, Renju 분석, 100/500 visits benchmark까지 통과했다. Apple은 [OpenCL을 deprecated로 표시](https://developer.apple.com/opencl/)하므로 Eigen은 계속 fallback으로 유지한다.
- **CUDA/TensorRT:** NVIDIA 전용이므로 이 Apple M5의 네이티브 선택지가 아니다.
- **Eigen:** 이번 단계에서 실제 빌드와 추론을 통과한 기준 백엔드다.

최신 일반 KataGo의 Metal 코드는 Swift, CoreML/MPSGraph, 새 CMake 구조를 함께 쓰므로 옵션 한 줄을 복사하는 수준이 아니다. KataGomo로의 포팅은 별도 코드 차이 분석과 검증이 필요한 대형 작업이며 시작하지 않았다.

## 모델 검증

| 항목 | 값 |
|---|---|
| 파일 | `models/zhizi_renju28b_s1600.bin.gz` |
| 공식 자산 | [직접 다운로드](https://github.com/hzyhhzy/KataGomo/releases/download/Gomoku_20250206/zhizi_renju28b_s1600.bin.gz) |
| 파일 크기 | 269,873,929 bytes |
| SHA-256 | `5aa1381aa37ba1b724469c5c8df3b59177079f5c57b355856e144b8146581f6f` |
| gzip 원본 크기 | 291,522,074 bytes |
| 모델 버전 | 102 |
| 로딩된 모델 이름 | `zhizigo_renju28b-b28c512nbt-s1617930240-d2051476833` |

GitHub 자산 메타데이터에는 이 독립 모델의 digest가 없어 SHA-256은 다운로드 후 로컬에서 계산했다. 크기, gzip 무결성, SHA-256, 압축 해제 헤더, 엔진 로딩 로그를 각각 확인했다. 릴리스 본문은 `b28c512nbt`와 Renju/Freestyle/Standard/Caro를 명시하며, 독립 `.bin.gz` 자산명과 엔진의 모델 이름에도 `renju28b`가 들어간다. 일반 바둑용 b28 모델은 사용하지 않았다. 전체 메타데이터는 `models/MANIFEST.json`에 있다.

모델 파일과 빌드 결과는 `.gitignore` 대상이다.

## CPU benchmark

조건은 15×15 빈 시작 포지션, 공식 `benchmark` 명령, Eigen, `nnRandomize=false`, 단일 포지션, b28c512nbt다. 테스트 SGF는 `benchmarks/empty-15.sgf`이며 첫 수 직전의 빈 판을 결정적으로 선택하게 만들었다.

100 visits 스레드 비교:

| search threads | visits/s | 검색 시간 |
|---:|---:|---:|
| 1 | 4.53 | 22.1 s |
| 2 | 8.33 | 12.1 s |
| 4 | 14.92 | 6.9 s |
| 6 | 17.28 | 6.1 s |
| **8** | **17.88** | **6.0 s** |
| 10 | 4.80 | 22.7 s |

8 threads 고정 측정:

| visits | visits/s | 순수 검색 시간 |
|---:|---:|---:|
| 100 | 21.68 | 4.9 s |
| 500 | 22.51 | 22.5 s |
| 1000 | 21.68 | 46.5 s |

각 실행의 모델 초기화 시간은 위 검색 시간에 포함되지 않는다. 모델 로딩은 로그상 약 3~4초였다. 수치는 이 Mac에서 보존한 단일 측정값이며 추측값이 아니다. 10-thread sweep은 10개 Eigen server 중 하나에만 평가가 몰리며 4.80 visits/s로 급락한 실제 이상 측정이었다. 더 좋은 값으로 치환하지 않았으며, 8 threads를 기본값으로 유지한다. 같은 8-thread 100-visits도 별도 실행에서는 21.68 visits/s였으므로 짧은 단일 포지션 값에는 실행 간 변동이 있다.

`make benchmark`와 `make benchmark-threads`는 각 실행의 stdout/stderr 원문을 `artifacts/stage1/benchmark/*.log`에 남긴다. 이 디렉터리는 재생성 가능한 런타임 산출물이므로 Git에는 포함하지 않는다.

중요한 제한이 있다. 이 커밋의 benchmark 구현은 SGF의 rule을 무시하고 내부 `Rules::getTrompTaylorish()`를 사용하며, Gom2024에서 이는 Freestyle 기본값이다. 따라서 위 표는 **같은 15×15 네트워크와 MCTS의 처리량 측정**이지 Renju 규칙 품질 측정이 아니다. 기본 내장 benchmark SGF는 긴 바둑 수순이라 Gomoku에서 중간에 이미 종료되어 `Illegal move in SGF`로 실패했고, 이를 숨기지 않고 별도 합법 시작 SGF를 사용했다. 아래 smoke test는 실제 Renju 규칙 객체로 수행했다.

## 실제 15×15 Renju 분석

요청은 `B H8, W H9` 다음 흑 차례이며, 문자열 `"RENJU"`가 아니라 Gom2024가 실제로 파싱하는 규칙 객체를 보낸다.

```json
{"id":"stage1-renju-100","moves":[["B","H8"],["W","H9"]],"rules":{"basicrule":"RENJU","vcnrule":"NOVC","firstpasswin":false,"maxmoves":0},"boardXSize":15,"boardYSize":15,"maxVisits":100,"analysisPVLen":8,"includePolicy":true,"reportDuringSearchEvery":1.0,"overrideSettings":{"reportAnalysisWinratesAs":"BLACK","wideRootNoise":0.0,"rootSymmetryPruning":false}}
```

실제 실행에서 검색 도중 응답 5개와 최종 응답 1개가 stdout JSONL로 왔고, stderr에는 엔진 로그만 왔다. 모든 응답의 policy 길이는 `15×15+pass = 226`이었다. 최종 응답의 실제 일부는 다음과 같다. 생략 표시는 설명용이며 원본 JSON에는 없다.

```json
{
  "id": "stage1-renju-100",
  "isDuringSearch": false,
  "moveInfos": [
    {
      "move": "G9",
      "order": 0,
      "prior": 0.158203125,
      "visits": 14,
      "winrate": 0.990965664,
      "pv": ["G9", "J7", "F10", "G8", "J10", "F11"]
    }
  ],
  "policy": ["실제 원본에는 숫자 226개"],
  "rootInfo": {
    "currentPlayer": "B",
    "visits": 107,
    "winrate": 0.979394522,
    "utility": 0.958789044
  },
  "turnNumber": 2
}
```

전체 원본은 `artifacts/stage1/analysis-response.jsonl`에 있다. 정책 배열의 `H8`과 `H9` 인덱스는 실제로 `-1`, `G9` raw policy는 `0.158203125`였다. `maxVisits=100`보다 root visits가 107인 것은 8개 search thread의 진행 중 평가 때문에 소폭 overshoot한 결과다.

8-thread MCTS의 스케줄링 때문에 smoke를 다시 실행하면 visits 배분과 winrate의 마지막 자릿수는 조금 달라질 수 있다. 검증은 특정 숫자를 고정하지 않고 실제 필드, policy 길이, 중간/최종 응답 계약을 검사한다.

`config/analysis.cfg`는 승률을 **항상 흑 관점**으로 고정한다. 따라서 위 `winrate`는 현재 차례 관점이 아니라 흑 승률이다. UI에서는 이를 명시하고 필요할 때만 백 승률을 `1 - blackWinrate`로 계산해야 한다. `wideRootNoise=0.0`으로 두어 `moveInfos[].prior`와 전체 raw policy를 비교 가능하게 했고, `rootSymmetryPruning=false`로 대칭 복제 visits가 visit-share 분모를 왜곡하지 않게 했다.

## 발견한 호환성 및 API 문제

1. `Compiling.md`의 CMake/C++ 요구사항은 낡았다. 실제 CMakeLists는 CMake 3.18.2와 C++17을 요구한다.
2. Apple용 CMake가 `/usr/local/include`를 무조건 추가해 Apple Silicon에서 `no such include directory` 경고가 난다. Homebrew의 실제 prefix는 `/opt/homebrew`다.
3. Eigen 5는 발견되지만 오래된 CMake 코드가 include 변수를 받지 못해 최초 빌드가 `Eigen/Dense file not found`로 실패했다. `EIGEN3_INCLUDE_DIRS`를 명시해 공식 소스 수정 없이 해결했다.
4. 소스의 일부 중국어 주석이 UTF-8이 아니어서 최신 Apple Clang이 매우 많은 `invalid UTF-8 in comment` 경고를 낸다. 컴파일 결과에는 영향을 주지 않았다.
5. `libzip`이 없어 self-play 학습 데이터 쓰기는 비활성화됐다. 분석/GTP에는 필요하지 않으므로 설치하지 않았다.
6. 소스에 Metal backend가 없다. OpenCL 1.2는 Apple M5에서 실추론까지 성공했지만 FP16/tensor 경로의 `cl2Metal failed` 뒤 FP32로 정상 fallback했다. 제한된 macOS sandbox 안에서는 GPU 열거가 `CL_INVALID_VALUE`로 실패할 수 있어 네이티브 실행이 필요하다.
7. 상속된 Analysis 문서의 Go용 예시와 현재 Gom2024 구현이 일부 다르다. Renju는 JSON rules 객체가 필요하고, 현재 응답에는 문서 예시의 score/ownership 계열 값이 없다.
8. `policy=-1`은 일반적으로 점유/기본 legality mask지만 Renju 흑 금수를 보장하지 않는다. 그래서 별도 helper가 공식 `Board::isForbidden()`을 호출한다.

## Stage 1 체크포인트

Stage 1 결과는 루트 저장소의 `7c26cbc` (`checkpoint: complete stage 1 engine validation`)에 보존했다. 모델, 빌드 결과, 로그, `.venv`, `vendor/`는 커밋하지 않았다. 공식 소스 작업 트리는 커밋 `df152116e3787c75c6a3de099d261ca092b7dfc1`에서 clean 상태를 유지한다.

## Stage 1.5: Apple M5 OpenCL 실검증

configure 성공만 확인한 것이 아니다. 네이티브 macOS 프로세스에서 Apple M5 GPU를 열거하고, 같은 `zhizi_renju28b_s1600.bin.gz`를 로드한 뒤 `B H8, W H9` 15×15 Renju 분석과 benchmark를 모두 실행했다.

| Visits | CPU/Eigen | OpenCL | CPU 검색 시간 | OpenCL 검색 시간 | OpenCL 배속 |
|---:|---:|---:|---:|---:|---:|
| 100 | 21.68 visits/s | 95.68 visits/s | 4.9 s | 1.1 s | 4.41× |
| 500 | 22.51 visits/s | 90.24 visits/s | 22.5 s | 5.6 s | 4.01× |

OpenCL은 이 Mac의 기본값으로 채택했고 CPU/Eigen은 fallback으로 남겼다. 첫 실행은 약 40초의 autotune이 필요하며 이후에는 `artifacts/runtime/opencl/opencltuning/`의 결과를 재사용한다. `nnMaxBatchSize=8`이 필요하다. FP16/tensor 커널은 `cl2Metal failed`였지만 엔진이 FP32 storage/compute로 정상 fallback했고 분석과 종료는 안정적으로 끝났다. Metal 포팅은 시작하지 않았다.

전체 configure/build/device/model/analysis/benchmark 원문은 `artifacts/stage1_5/opencl/`에 있다. 이 경로는 로컬 검증 산출물로 보존하지만 Git에는 넣지 않는다.

## Stage 2 분석 서버

FastAPI lifespan 동안 KataGomo analysis 자식 프로세스 하나만 유지한다. 서버 시작 때 `query_version`으로 준비 상태를 확인하고, stdout의 JSON Lines와 stderr 로그를 분리한다. stderr는 `artifacts/stage2/engine-stderr.log`에 남는다.

- 한 WebSocket 분석 세션만 허용하며 두 번째 연결은 `session_busy`로 거부한다.
- 요청마다 공개 UUID와 별도 엔진 ID를 붙인다.
- 새 요청은 현재 엔진 ID에 `terminate`를 보내고 즉시 대체한다.
- 취소 뒤 늦게 도착한 응답은 active ID와 process generation으로 무시한다.
- `isDuringSearch`로 중간 결과를, `isFinal`로 최종 결과를 구분한다.
- 비정상 종료를 감지해 요청자에게 오류를 보내고 프로세스를 한 번만 재시작한다.
- 서버 종료 시 active 요청 취소, `terminate_all`, stdin EOF 순으로 정상 종료를 시도한다.

기본 엔진 요청은 15×15 Renju, `maxVisits=100`, `includePolicy=true`, `includePVVisits=true`, `reportDuringSearchEvery=0.5`다. 규칙은 문자열이 아니라 Gom2024가 실제 파싱하는 Renju 객체로 보낸다. 승률 원시 계약은 항상 `BLACK`이다.

### API와 WebSocket

| 경로 | 용도 |
|---|---|
| `GET /api/status` | 엔진 PID/state/restart/stale 수, helper 및 Python 상태 |
| `POST /api/legality` | 공식 helper의 `forbiddenMoves`와 `legalMoves` |
| `WS /ws/analysis` | 분석 시작·취소와 중간/최종 스트림 |

분석 요청 예:

```json
{"action":"analyze","moves":[["B","H8"],["W","H9"]],"maxVisits":100,"reportDuringSearchEvery":0.5,"userColor":"B","clientRequestId":"example"}
```

다음은 OpenCL 서버에서 `make websocket-smoke`로 받은 **실제 최종 응답을 핵심 필드만 발췌**한 것이다. 이 smoke는 빠른 OpenCL 검색도 0.5초 간격 중간 응답을 반드시 내도록 500 visits를 사용하며, 서버 기본값은 100이다. 전체 policy 226개와 모든 후보/PV visits가 들어 있는 원문은 `artifacts/stage2/websocket-response.jsonl`에 있다.

```json
{
  "type": "analysis",
  "isDuringSearch": false,
  "isFinal": true,
  "analysisState": "complete",
  "winratePerspective": "BLACK",
  "currentPlayer": "B",
  "userColor": "B",
  "candidateVisitTotal": 506,
  "policyLength": 226,
  "topCandidate": {
    "move": "G9",
    "rawPrior": 0.158203125,
    "visits": 71,
    "visitShare": 0.14031620553359683,
    "blackWinrate": 0.977742337,
    "pv": ["G9", "J7", "F10", "J10", "F8", "F7", "G8", "J8", "J11", "J6", "J9", "J4", "J5", "E7", "H7"]
  },
  "rootInfo": {
    "visits": 507,
    "blackWinrate": 0.96805789
  }
}
```

`rawPrior`는 반드시 전체 `policy[coordinateIndex]`에서 읽고 `searchPrior`는 엔진 `moveInfos[].prior`로 별도 보존한다. `visitShare` 분모는 반환된 모든 후보의 visits 합이다. 합이 0이면 share를 0으로 두고 `analysisInsufficient=true`를 반환한다. `blackWinrate`만 원시값이고 `currentPlayerWinrate`와 `userWinrate`는 색을 명시한 변환값이다.

## Renju 금수 helper

`native/forbidden_helper/`는 공식 translation unit을 소스 수정 없이 링크해 `Board::isForbidden()`을 직접 호출한다. 입력은 현재 수순과 다음 차례, 출력은 JSON `forbiddenMoves`, `legalMoves`, `source`다. 흑 차례에만 금수를 검사하며 백 차례에는 같은 모양도 금수로 만들지 않는다. analysis의 `policy=-1`은 사용하지 않는다.

```bash
make forbidden-helper
printf '%s\n' '{"moves":[],"nextPlayer":"B"}' | build/forbidden-helper/forbidden_helper
```

fixture는 RIF/RenjuNet의 [공식 규칙](https://www.renju.net/rifrules/), [고급 교육 자료](https://www.renju.net/advanced/), [금수 도해](https://www.renju.net/upload/staticfiles/forbiddens.jpg)에 근거한다. 첫 네 사례는 도표의 국소 패턴을 KataGomo 좌표로 정규화·분리하고 교대 수순용 비간섭 filler를 더한 것이다. 백 미적용과 빈 판 H8은 각각 RIF §9.2와 §4.2에서 도출한 불변조건이다. 이 변환 내역은 각 fixture의 `provenance`에 기록했다. 장목, 4×4, 3×3, 가짜 열린 3, 백 미적용, 빈 판 일반 합법 수가 모두 통과한다. 진단 UI에서도 해당 3×3 패턴의 `M5`가 표시되고 클릭이 차단되는 것을 실제 브라우저로 확인했다.

## 진단 UI

`make dev` 후 [http://127.0.0.1:8000](http://127.0.0.1:8000)에 접속한다. 15×15 교차점을 클릭하고 분석 시작/취소/무르기/초기화를 할 수 있다. 중간 결과마다 보드와 상위 후보 5개가 갱신되며 move, raw policy, visits, visit share, 흑 승률, PV와 raw-policy 상위 5개를 분리해 표시한다. 엔진/연결/검색/최종 상태, policy 길이, 후보 visits 합, 공식 금수도 함께 표시한다.

이 페이지는 데이터 흐름을 검증하는 Stage 2 진단 화면이다. AI 자동 착수, 초반 종료와 채점, 반복 연습 UX는 아직 포함하지 않는다.

## 실제 후보 분포: 100 vs 500 visits

같은 `B H8, W H9` 포지션을 persistent CPU/Eigen 프로세스에서 연속 분석했다. 수치는 스레드 스케줄링으로 재실행 때 조금 달라질 수 있다.

| 항목 | 100 visits | 500 visits |
|---|---:|---:|
| 요청 포함 경과 | 5.094 s | 17.241 s |
| 중간 응답 | 10 | 34 |
| root visits | 107 | 507 |
| 후보 수 | 14 | 17 |
| 후보 visits 합 | 106 | 506 |
| MCTS 상위 5 | G9, J9, K8, F8, G10 | G9, J9, K8, F8, J10 |

raw policy 상위 5는 두 분석 모두 `J9, G9, K8, F8, G10`이었다. 500 visits에서 MCTS 5위가 `J10`으로 달라졌다. 따라서 네트워크의 raw policy와 검색 visits는 같은 값처럼 합치지 않고 UI에 별도 표시해야 한다.

100 visits에서 `moveInfos`가 한 개뿐이라는 현상은 다시 실행한 어느 결과에서도 재현되지 않았다. 실제 최종 후보는 14개였고, 이전 문서의 JSON이 첫 후보 한 개만 발췌한 예시였던 것이 원인이다. 전체 비교는 `artifacts/stage2/candidate-distribution/comparison.json`에 있다.

## 테스트

```bash
make test
make integration-test
make dev                  # 별도 터미널에서 유지
make websocket-smoke      # 실제 OpenCL 서버 WebSocket 검증
make compare-visits
```

단위/프로세스 테스트는 좌표 왕복, 수순 스키마, JSON Lines, 분할된 JSON stream, visit share, BLACK→현재 차례/백 사용자 승률, cancel, supersede 및 stale 무시, 엔진 종료·1회 재시작, policy 226, 단일 WebSocket 세션, 금수 helper를 다룬다. 실제 통합 테스트는 mock이 아니라 Eigen 엔진과 공식 모델로 `B H8, W H9`를 분석해 중간 응답 1개 이상과 최종 응답 1개, prior/visits/winrate/PV/policy를 확인한다.

최종 회귀 결과는 `make test` **39 passed, 1 deselected**, `make integration-test` **1 passed, 39 deselected**다. 실제 OpenCL `make websocket-smoke`의 최근 실행은 500 visits에서 중간 응답 11개와 최종 응답 1개, policy 길이 226, 후보 16개를 검증했다. 먼저 잘못된 수순에 JSON `validation_error`를 받고 같은 연결에서 분석이 계속되는 것도 확인한다. 중간 응답 개수와 후보 배분은 실행 스케줄링에 따라 달라질 수 있지만 smoke는 중간 응답 1개 이상과 필수 필드를 강제한다.

## 문제 해결

- 모델: `make verify-model`로 크기, SHA-256, gzip 및 헤더를 다시 확인한다.
- helper 누락: `make forbidden-helper`를 실행한다. helper 오류 중에는 UI 착수를 안전하게 차단한다.
- OpenCL 첫 시작: autotune 때문에 약 40초 걸릴 수 있다. 제한된 sandbox에서 장치 열거가 실패하면 일반 Terminal에서 실행한다.
- OpenCL 실패: 위의 `KATAGOMO_ENGINE`/`KATAGOMO_ANALYSIS_CONFIG` 예제로 Eigen을 강제한다.
- 엔진 로그: `artifacts/stage2/engine-stderr.log`와 `engine-invalid-stdout.log`를 확인한다.
- 포트 충돌: `KATAGOMO_PORT=8001 make dev`처럼 바꾼다.

오류 때 가짜 분석값이나 Python 금수 구현으로 대체하지 않는다.

## Stage 3 전에 결정할 사항

1. Apple M5 실측상 100 visits는 반응성이 좋고 500은 더 안정적이다. AI 착수와 수별 채점에 각각 어떤 기본 분석량을 쓸지 정한다.
2. 분석 visits가 적을 때 “분석 부족”으로 판정할 최소 root/candidate visits 기준을 정한다.
3. AI가 최종 응답 뒤에만 둘지, 충분한 중간 visits에 도달하면 둘지 정한다.
4. “같은 시작점”과 “새 초반 시작”이 빈 판, 고정 첫 수, 무작위 policy 시작 중 무엇을 뜻하는지 정한다.
5. 즉시 채점과 종료 후 채점에서 사용자에게 보여줄 winrate 차이·visit 순위·policy의 표현 방식을 정한다. 엔진 원시값은 계속 BLACK으로 유지한다.

Stage 3 범위는 AI 자동 착수, 흑/백 연습, 6~16수 종료, 수별 채점과 가장 큰 실수 3개, 즉시/종료 후 채점, 반복 버튼, localStorage 기록이다. OpenCL/Metal 포팅 작업은 포함하지 않는다.

## 프로젝트 경로

```text
config/                         CPU/OpenCL analysis 및 benchmark 설정
native/forbidden_helper/        공식 Board::isForbidden() 호출 어댑터
server/                         FastAPI, persistent engine, 변환/legality
web/                            Stage 2 진단 보드
tests/                          단위·프로세스·실제 엔진 통합 테스트
scripts/                        빌드, 실행, smoke, 후보 비교
artifacts/stage1_5/opencl/      OpenCL 실검증 원문, Git 제외
artifacts/stage2/               실제 서버/후보 분포 결과, Git 제외
vendor/KataGomo/                공식 clean clone, Git 제외
build/engine-eigen/             CPU/Eigen 실행 파일, Git 제외
build/engine-opencl/            OpenCL 실행 파일, Git 제외
models/                         모델 본체는 Git 제외, manifest만 추적
```
