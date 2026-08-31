# KataGomo 기반 오목 초반 연습 프로그램

현재는 **1단계(엔진 구동 검증)까지 완료**된 상태다. macOS ARM64에서 공식 KataGomo `Gom2024` 소스를 CPU/Eigen으로 빌드했고, 공식 Renju `b28c512nbt` 모델을 실제로 로드해 15×15 Renju JSON 분석과 검색 도중 응답을 확인했다. 웹 서버와 UI는 아직 만들지 않았다.

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

이번 단계에서 새로 설치한 것은 `cmake`(67.2 MB)와 `eigen`(10.2 MB)뿐이다. `jq`와 CPython 3.14.6은 이미 설치되어 있어 새 다운로드가 없었다. 기존 `python3`로 프로젝트 전용 `.venv`를 생성했으며, FastAPI 등 웹 의존성은 아직 설치하지 않았다.

## 빠른 재현

모든 명령은 이 README가 있는 프로젝트 루트에서 실행한다.

```bash
make setup       # cmake/eigen/jq 준비 + 기존 Python 3.11 이상으로 .venv 생성
make engine      # 공식 커밋을 가져와 ARM64 CPU/Eigen 엔진 빌드
make model       # 공식 모델 269,873,929바이트 다운로드 및 검증
make smoke       # 실제 15x15 Renju JSONL 분석
make benchmark   # 8 threads, 100/500/1000 visits 순차 측정(약 2분)
make benchmark-threads # 100 visits에서 1/2/4/6/8/10 threads 비교
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

`make dev`와 로컬 서버는 2단계 범위라 아직 제공하지 않는다.

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
- **OpenCL:** [OpenCL CMake 경로](https://github.com/hzyhhzy/KataGomo/blob/df152116e3787c75c6a3de099d261ca092b7dfc1/cpp/CMakeLists.txt#L328-L346)와 [Apple 전용 OpenCL 헤더 경로](https://github.com/hzyhhzy/KataGomo/blob/df152116e3787c75c6a3de099d261ca092b7dfc1/cpp/neuralnet/openclincludes.h#L4-L12)는 실제로 있다. 이 Mac에서 별도 패키지 없이 CMake configure를 실행해 macOS SDK의 `OpenCL.framework` 1.2가 탐지되는 것까지 확인했다. 그러나 Apple은 [OpenCL을 deprecated로 표시](https://developer.apple.com/opencl/)하므로 M5 장치 열거·커널 튜닝·모델 추론까지 성공한다고 아직 판단하지 않았다.
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
6. 소스에 Metal backend가 없다. OpenCL 1.2 framework configure는 성공했지만 Apple M5 장치/커널/모델 런타임은 아직 검증하지 않았다.
7. 상속된 Analysis 문서의 Go용 예시와 현재 Gom2024 구현이 일부 다르다. Renju는 JSON rules 객체가 필요하고, 현재 응답에는 문서 예시의 score/ownership 계열 값이 없다.
8. `policy=-1`은 일반적으로 점유/기본 legality mask지만 Renju 흑 금수를 보장하지 않는다. 자세한 내용은 다음 절의 결정 사항에 있다.

## 2단계 전에 결정할 사항

### 1. Renju 흑 금수 노출 방식

현재 공식 Gom2024의 `Board::isForbidden()`과 `ForbiddenPointFinder`는 금수를 계산하지만, `BoardHistory::isLegal()`은 빈 칸 여부만 검사한다. analysis JSON에도 금수 mask가 없으며, 흑이 금수에 두면 “입력 거부”가 아니라 게임 로직에서 백 승으로 처리된다. 따라서 UI가 analysis의 `policy=-1`만 보고 금수를 막으면 틀릴 수 있다.

권장 결정은 공식 소스의 `Board::isForbidden()` 결과를 그대로 호출하는 **최소 로컬 어댑터**다. 선택지는 다음 두 가지다.

- analysis 응답에 `forbiddenMoves`를 추가하는 작은 패치
- 공식 소스에 링크한 별도 legality helper/subcommand를 두어 원본 analysis 프로토콜은 유지

UI에서 금수 규칙을 독자 재구현하는 방식은 권장하지 않는다. 어느 어댑터 형태를 택할지 2단계 시작 전에 정해야 한다.

### 2. CPU 분석량과 OpenCL 조사 순서

보존한 8-thread 실행에서 100 visits는 약 4.9초, 500 visits는 약 22.5초다. 실시간 중간 결과는 오지만 AI 자동 착수와 반복 연습에는 500~1000 visits가 느리다.

- 먼저 2단계 래퍼를 100 visits 기본값으로 구현하고 분석 부족 표기를 유지하거나
- 2단계 전에 별도 OpenCL 빌드·장치 열거·실제 모델 추론을 검증할 수 있다.

Metal 포팅은 이 선택지에 포함하지 않는다. OpenCL 실패 시 CPU 경로를 그대로 유지하고 오류를 숨기지 않는다.

### 3. Python 환경 및 의존성 호환성 확인

별도 Python은 설치하지 않는다. 현재 설치된 CPython 3.14.6으로 다음과 같이 프로젝트 전용 가상환경을 이미 만들었고, `.venv/pyvenv.cfg`의 `version = 3.14.6`도 확인했다.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -VV
```

2단계 의존성은 이 `.venv`에만 설치한다. FastAPI 및 선택한 ASGI 서버의 실제 설치·테스트에서 Python 3.14 고유의 호환성 문제가 확인될 때만 다른 3.11 이상 버전을 검토하며, 사전 추측만으로 특정 Python 버전을 추가 설치하지 않는다.

### 4. 승률 계약

권장은 엔진 응답을 계속 `BLACK` 관점으로 고정하고 API/UI 스키마에도 `winratePerspective: "BLACK"`을 명시하는 것이다. `SIDETOMOVE`로 바꾸면 수마다 의미가 뒤집혀 채점 버그 위험이 커진다.

## 프로젝트 경로

```text
config/                 benchmark 및 analysis 설정
benchmarks/             합법적인 15x15 처리량 측정 SGF
smoke/                  실제 Renju JSONL 요청
scripts/                고정 커밋 빌드, 모델 검증, smoke, benchmark
artifacts/stage1/        실제 JSONL 결과(로그는 gitignore)
vendor/KataGomo/         공식 소스 clone, gitignore
build/engine-eigen/      ARM64 Eigen 빌드, gitignore
models/                  모델 파일은 gitignore, manifest만 추적
```

엔진을 수동 실행했을 때는 stdin EOF로 정상 종료한다. 진행 중 프로세스는 `Ctrl-C`로 중단할 수 있다. 로컬 서버의 엔진 수명주기와 요청 취소는 2단계에서 구현한다.
