# KataGomo Renju Practice

> 로컬 15×15 Renju 연습 플랫폼

KataGomo Renju Practice는 공식 [KataGomo](https://github.com/hzyhhzy/KataGomo) 엔진과 공식 릴리스에서 다운로드되는 Renju 신경망을 그대로 사용해, Mac에서 혼자 수를 놓고 실시간 분석을 확인하는 데스크톱 웹 앱이다. 별도 계정이나 클라우드 서버 없이 `127.0.0.1`에서 실행된다.

신경망 가중치는 공개 다운로드되지만 릴리스 페이지에 별도 라이선스가 명시되어 있지 않다. 이 저장소는 모델을 포함하거나 재배포하지 않고 사용자의 Mac에서 원본 자산을 직접 받으며, 모델에 대한 사용·재배포 권리를 별도로 부여하지 않는다. 자세한 범위는 [Third-party notices](THIRD_PARTY_NOTICES.md)를 확인한다.

이 프로젝트의 범위는 명확하다.

- 보드는 항상 **15×15**다.
- 규칙은 항상 **Renju**다. Freestyle, Standard, Caro 전환 기능은 제공하지 않는다.
- 흑부터 교대로 착수하는 분석·연습 도구이며 별도의 대회 오프닝 프로토콜을 자동 진행하지 않는다.
- 새로운 신경망이나 MCTS를 구현하지 않는다. KataGomo의 raw policy와 MCTS 결과를 보여준다.
- 흑 금수와 공식 종국은 브라우저에서 재구현하지 않고 KataGomo 공식 C++ 코드로 판정한다.
- 데스크톱 사용을 대상으로 하며 모바일 UI는 현재 범위가 아니다.

## 제공 기능

- **AI와 연습:** 사용자가 흑 또는 백을 맡고 AI가 반대쪽을 둔다.
- **양쪽 직접 두기:** 사용자 색을 정하지 않고 흑·백을 번갈아 놓으며 원하는 위치를 분석한다.
- **공식 금수·종국 판정:** 흑의 3×3, 4×4, 장목과 승리·금수패·무승부를 공식 KataGomo 코드로 판정한다.
- **실시간 분석:** 검색 도중과 최종 결과의 Raw policy, Visits, Visit share, Winrate (Black), PV, Order, Root visits를 표시한다.
- **후보 비교:** policy와 MCTS visits를 합치지 않고 별도로 보여준다.
- **수 비교 실험실:** 현재 판을 바꾸지 않고 두 합법 수를 같은 visits로 강제 분석해, 착수 전 policy/MCTS 근거와 착수 후 승률·상대 최선 응수·PV를 나란히 본다.
- **반복 연습:** 6, 8, 10, 12, 14, 16수 종료 또는 제한 없이 진행할 수 있다. 실제 종국은 선택한 수 제한보다 항상 우선한다.
- **기록과 복기:** 수별 추천 수, policy/visit 순위, 승률 변화와 큰 실수를 확인하고 읽기 전용 복기판에서 다시 살펴본다.

완료한 연습은 현재 브라우저의 `localStorage` 키 `katagomo.renjuPractice.v2`에 최신 20판까지 저장된다. 각 사용자 수 직전 최종 분석의 Order 기준 상위 10개 후보와 PV만 축약해 보존하고, 226개 전체 policy 배열은 반복 저장하지 않는다. 기존 `katagomo.openingPractice.v1` 기록은 자동 변환하며 v2 저장소 자체가 손상된 경우에도 v1을 복구 후보로 사용하고 진단을 화면에 남긴다. 기록별 삭제와 전체 삭제가 가능하다.

복기판에서는 처음·이전·다음·마지막 수로 이동하고 당시 수별 평가, 후보, PV와 큰 실수 위치를 확인한다. 복기만 하는 동안 라이브 보드는 바뀌지 않으며, 사용자가 명시적으로 **이 위치에서 연습**을 누른 비종국 위치만 새 연습 시작점으로 복사한다. 기록은 다른 브라우저·프로필과 자동 동기화되지 않으며 사이트 데이터를 지우면 함께 삭제된다.

## 요구 환경

현재 지원·검증 대상은 macOS 데스크톱이다.

| 항목 | 요구 사항 |
|---|---|
| macOS | 데스크톱 macOS. Apple Silicon M5에서 검증했으며 Intel Mac은 아직 실기 검증하지 않았다. |
| Homebrew | CMake, Eigen, jq 설치에 사용 |
| Python | 기존에 설치된 안정적인 CPython **3.11 이상** |
| Node.js | 18 이상. 브라우저 단위 테스트 실행에 필요 |
| Compiler | Apple Command Line Tools의 C++17 compiler |
| 디스크 | 모델 약 257 MiB, 엔진 소스·빌드·가상환경을 위한 추가 여유 공간 |

특정 Python 버전을 새로 설치하지 않는다. `make setup`은 현재 `python3`가 3.11 이상인지 확인하고 프로젝트 전용 `.venv`를 만든다. 이 저장소에서 실제 검증한 버전은 CPython 3.14.6이다.

처음 설치하는 Mac이라면 아래 두 명령으로 Apple Command Line Tools와 Homebrew가 준비됐는지 먼저 확인한다. 명령이 없다고 나오면 Command Line Tools는 `xcode-select --install`로 설치하고, Homebrew는 [공식 설치 안내](https://brew.sh/)를 따른다.

```bash
xcode-select -p
brew --version
```

## 처음 설치

GitHub에서 저장소를 clone한 뒤 프로젝트 루트에서 실행한다. 첫 명령은 Homebrew로 `cmake`, `eigen`, `jq`를 설치하고 Python 패키지를 `.venv`에 설치한다. 모델 다운로드는 269,873,929 bytes(약 257 MiB)다.

처음부터 전체 CPU/Eigen 환경을 준비하고 실제 smoke까지 확인하려면 다음 한 명령을 사용할 수 있다.

```bash
make bootstrap
```

각 단계를 따로 확인하거나 실패 지점을 분리하려면 아래 명령을 순서대로 실행한다.

```bash
make setup
make engine
make model
make forbidden-helper
make smoke
```

각 명령의 역할은 다음과 같다.

- `make setup`: 필요한 최소 Homebrew 패키지와 `.venv` 의존성 준비
- `make engine`: 고정된 공식 KataGomo 커밋을 가져와 CPU/Eigen 엔진 빌드
- `make model`: 공식 Renju b28c512nbt 모델만 다운로드하고 크기·gzip·SHA-256 검증
- `make forbidden-helper`: 공식 `BoardHistory`와 `Board::isForbidden()`을 사용하는 position helper 빌드
- `make smoke`: 실제 엔진·실제 모델로 15×15 Renju JSONL 분석 검증

기존 소스 디렉터리의 remote/commit이 다르거나 로컬 변경이 있으면 스크립트는 덮어쓰지 않고 중단한다. 기존 모델의 크기나 해시가 다를 때도 파일을 교체하지 않는다.

## 실행과 종료

```bash
make dev
```

브라우저에서 [http://127.0.0.1:8000](http://127.0.0.1:8000)을 연다. `localhost` 대신 위 주소를 그대로 사용하는 편이 명확하다.

이 앱에는 로그인이나 사용자 인증이 없고 loopback 바인딩이 주 접근 통제다. 지원 실행 명령은 exact loopback Host와 같은 origin의 브라우저 WebSocket만 허용하지만, 같은 Mac의 로컬 프로세스는 origin 없이 연결할 수 있다. `make dev`의 `127.0.0.1` 바인딩을 LAN 주소로 바꾸거나 reverse proxy로 외부에 공개하는 사용법은 지원하지 않는다.

연습 기록은 브라우저 origin별로 저장된다. 따라서 `127.0.0.1:8000`과 `127.0.0.1:8001`, 또는 `localhost:8000`은 서로 다른 기록 저장소로 보인다. 기존 기록을 계속 보려면 같은 주소와 포트를 사용한다.

종료할 때는 `make dev`를 실행한 터미널에서 `Ctrl-C`를 누른다. FastAPI 서버가 끝날 때 persistent KataGomo analysis 프로세스에도 종료를 전달한다.

기본 백엔드는 **CPU/Eigen**이다. 빌드 디렉터리에 OpenCL 실행 파일이 있더라도 자동 선택하지 않는다. 이 기본값은 가장 빠른 설정이라는 뜻이 아니라, macOS에서 재현 가능한 안전한 설정이라는 뜻이다.

## 기본 사용법

앱에서 연습 방식과 분석량을 고르고 보드의 교차점을 누르면 된다. UI의 구체적인 배치는 바뀔 수 있지만 기능 계약은 다음과 같다.

화면은 왼쪽 **Renju 보드**와 오른쪽 단일 **분석 작업대**로 구성된다. 작업대의 `분석 / 수 비교 / 기록` 탭은 한 번에 선택한 기능만 보여준다. 분석 탭 안에서는 `MCTS 후보 / Raw policy`를 전환하며, 기술 용어와 엔진 세부정보는 작업대 하단에서 필요할 때만 펼친다.

- AI 연습에서는 흑 또는 백을 선택한다. AI는 최종 검색 결과의 `order=0` 후보만 자동 착수한다.
- 양쪽 직접 두기에서는 AI 자동 착수와 사용자 색 채점을 끄고 두 색을 직접 둔다.
- 기본 분석량은 100 visits이며 더 깊은 확인에는 500 visits를 선택할 수 있다.
- MCTS 후보 보기에서 원 크기 기준을 Raw policy 또는 Visit share로 바꿀 수 있다. 보드에는 모든 후보의 Order 원을 남기고, 전체 지표 라벨은 Order 0과 현재 가리키거나 고정한 후보에만 표시한다.
- 후보를 가리키거나 선택하면 PV 예상 수순을 보드에서 확인할 수 있다.
- 흑 금수는 표시되고 클릭이 차단된다. KataGomo 금수 판정이 실패하면 임의 판정 대신 안전하게 착수와 분석을 막는다.
- 수 제한에 도달하거나 공식 종국이 되면 결과와 수별 평가를 정리한다.

### 수 비교 실험실

한 위치에서 “왜 A는 좋고 B는 나쁜가?”를 수치와 예상 응수로 확인하려면 작업대의 **수 비교** 탭에서 **두 수 선택**을 누른다. 보드에서 A와 B를 고른 뒤 **같은 visits로 비교**를 실행한다. 선택 클릭은 가상 수만 지정하며 실제 수순에는 돌을 추가하지 않는다. 기본 결과는 Raw policy·MCTS·Winrate (Black)·상대 최선 응수만 먼저 보여주고, Root visits와 전체 원시 지표는 **전체 기술 지표**에서 펼쳐 본다.

한 번의 비교는 같은 persistent 엔진에서 다음 순서로 실행된다.

1. 착수 전 기준 위치
2. A를 강제 착수한 뒤 상대 차례 위치
3. B를 강제 착수한 뒤 상대 차례 위치

세 요청은 실행 시 선택된 100 또는 500 visits를 동일하게 사용한다. 따라서 500 visits 비교는 최대 세 번의 500-visits 검색이 필요하며 CPU/Eigen에서는 시간이 걸릴 수 있다. 화면에는 요청 예산뿐 아니라 A/B의 실제 Root visits도 그대로 표시한다.

- A/B의 **Raw policy, policy rank, MCTS Order, Visits, Visit share**는 착수 전 기준 위치에서 읽는다.
- **Winrate (Black), 상대 Order 0 응수, 응수 PV**는 각 수를 둔 뒤 위치에서 읽는다.
- 기준 차례가 백이면 “착수자 관점”은 `1 - Black winrate`로 변환하지만 원시 Black 값도 함께 남긴다.
- 기준 MCTS `moveInfos`에 선택 수가 없으면 Visits나 Order를 0으로 만들지 않고 `MCTS 후보 미반환`으로 표시한다.
- 선택 수가 즉시 승리로 끝나면 공식 KataGomo 종국 판정을 표시하고 MCTS Winrate를 임의로 100% 또는 0%로 만들지 않는다.
- KataGomo가 응수나 PV에 `PASS`를 반환하면 원문 그대로 표시한다. 보드 미리보기에는 돌을 그리지 않되, 다음 PV 돌의 색 계산에서는 한 차례로 센다.
- 비교 도중 취소·연결 종료·판 변경이 생기면 부분 결과로 결론을 만들지 않는다. 전체 비교를 다시 실행한다.

결과의 **A + 응수 PV 보기**, **B + 응수 PV 보기**로 가상 착수와 상대의 Order 0 PV를 라이브 보드 위에 겹쳐 볼 수 있다. 미리보기와 비교 결과를 보는 동안 실제 판은 고정되며, 계속 착수하려면 비교를 초기화한다. 이 기능은 차이를 구조화해 보여주지만 자연어로 전략적 인과를 생성하지는 않는다.

## 분석 용어

KataGomo와 다른 분석 도구에서 통용되는 용어를 그대로 사용한다.

| 용어 | 이 앱에서의 의미 |
|---|---|
| **Raw policy** | 신경망이 MCTS 검색 전에 각 착수에 준 원시 확률이다. 전체 226개 policy 배열에서 해당 교차점 값을 읽는다. 검색 결과인 Visits와 같은 값이 아니다. |
| **Visits** | MCTS가 한 후보를 탐색한 횟수다. 높을수록 검색이 그 후보에 더 많은 계산을 사용했다는 뜻이지, 그 자체가 승률은 아니다. |
| **Visit share** | `후보 visits / 반환된 모든 후보 visits 합`이다. 후보별 검색 비중을 비교하기 위한 값이며 Root visits를 분모로 쓰지 않는다. 분모가 0이면 0으로 표시하고 분석 부족으로 취급한다. |
| **Winrate (Black)** | 흑이 이길 것으로 보는 확률이다. 항상 **흑 관점**이므로 현재 차례가 백이어도 의미가 뒤집히지 않는다. 예를 들어 70%는 누가 둘 차례인지와 무관하게 흑 70%다. 백 관점은 `1 - Black winrate`다. |
| **PV** | Principal Variation. 해당 후보 뒤에 엔진이 가장 유력하다고 본 예상 진행 수순이다. 정답 수순을 보장하는 것은 아니다. |
| **Order** | KataGomo 검색이 반환한 추천 순서다. 원시 필드는 0부터 시작해 `order=0`이 첫 추천이다. Visits 순위와 반드시 같지는 않는다. |
| **Root visits** | 현재 위치 전체(root)에 사용된 MCTS visits다. 병렬 검색의 진행 중 평가 때문에 설정한 `maxVisits`를 조금 넘을 수 있고, 후보 visits 합과 정확히 같지 않을 수 있다. |

가장 직접적인 형세 지표는 Winrate (Black)이지만, 작은 visits에서는 값이 흔들릴 수 있다. 이 앱은 추천 수와의 승률 차이, visit 순위, raw policy, 실제 분석량을 함께 보여주고 분석량이 부족하면 확정적인 점수 대신 `분석 부족`으로 표시한다.

## Renju 판정의 기준

브라우저나 Python에서 Renju 금수 로직을 따로 만들지 않는다. `native/forbidden_helper/`가 수정하지 않은 공식 KataGomo translation unit에 링크된다.

- 진행 중 금수: 공식 `Board::isForbidden()`
- 승리·금수패·무승부: 공식 `BoardHistory::makeBoardMoveAssumeLegal()`과 `GameLogic`
- 규칙 객체: 15×15 Renju, NOVC, `firstPassWin=false`
- 최대 수: position helper에서 225로 두어 공식 full-board 무승부를 얻는다.
- analysis 엔진: 신경망 입력과 검색 동작을 바꾸지 않도록 `maxmoves=0` 계약을 유지한다.

position 응답은 `isTerminal`, `winner`, `outcome`, `terminalReason`, `terminalMove`, `forbiddenMoves`, `legalMoves`를 포함한다. 종료 사유는 `line_win`, `black_forbidden`, `board_full` 중 하나다. 종국이 되면 합법/금수 목록은 비고 추가 착수와 분석을 막는다.

KataGomo analysis의 `noResults=true`는 승패 신호가 아니다. 요청이 취소·중단되어 검색 결과를 만들지 못한 상태로 처리하며 `analysisState=canceled`로 표시한다. 공식 종국은 analysis를 시작하기 전에 position helper로 판정한다.

## 백엔드 선택

### CPU/Eigen — 기본값

```bash
make engine
make dev
```

CPU/Eigen은 GPU 권한이나 deprecated API에 의존하지 않으며 통합 테스트의 기준 백엔드다. 현재 설정은 8 search threads를 사용한다. 검증 호스트의 100 visits 검색은 단일 측정에서 약 4.9초였으므로, 하드웨어에 따라 실시간 감각은 달라질 수 있다.

### OpenCL — opt-in 실험 기능

KataGomo `Gom2024`에는 Apple Metal 백엔드가 없고 OpenCL만 있다. Apple의 OpenCL은 deprecated 상태이며 실행 환경과 호스트 상태에 민감하므로 자동 fallback이나 기본값으로 사용하지 않는다.

```bash
make opencl

KATAGOMO_ENGINE="$PWD/build/engine-opencl/katago" \
KATAGOMO_ANALYSIS_CONFIG="$PWD/config/analysis-opencl.cfg" \
make dev
```

이 설정은 두 환경변수를 반드시 함께 지정해야 한다. 실행 후 `/api/status`와 실제 분석으로 장치 열거, 모델 로딩, 15×15 Renju 결과까지 확인해야 한다. configure 성공이나 `katago version`만으로는 동작한다고 판단하지 않는다.

Apple M5에서 한 차례 네이티브 실추론과 benchmark에 성공해 CPU보다 약 4배 빠른 기록을 얻었지만, 같은 호스트의 최신 재실행에서는 장치 열거 단계가 `CL_INVALID_VALUE`로 실패했다. 따라서 OpenCL은 과거 측정값을 보존하되 현재 기본에서 제외했다. 실패하면 두 환경변수를 제거하고 CPU/Eigen으로 실행한다.

Metal 포팅은 이 프로젝트에서 시작하지 않았다.

## 환경변수

쉘에서 직접 지정한다. `.env.example`은 값의 예시이며 현재 실행 스크립트가 `.env`를 자동으로 읽지는 않는다.

| 환경변수 | 기본값/용도 |
|---|---|
| `KATAGOMO_ENGINE` | `build/engine-eigen/katago` |
| `KATAGOMO_MODEL` | `models/zhizi_renju28b_s1600.bin.gz` |
| `KATAGOMO_ANALYSIS_CONFIG` | `config/analysis.cfg` |
| `KATAGOMO_FORBIDDEN_HELPER` | `build/forbidden-helper/forbidden_helper` |
| `KATAGOMO_ENGINE_LOG` | `artifacts/stage2/engine-stderr.log` |
| `KATAGOMO_PORT` | 로컬 서버 포트, 기본 `8000` |
| `KATAGOMO_WEBSOCKET_URL` | `make websocket-smoke`가 사용할 전체 WebSocket URL |

예를 들어 다른 포트에서 CPU/Eigen을 실행하려면 다음처럼 지정한다.

```bash
KATAGOMO_PORT=8001 make dev
```

외부 경로의 검증된 엔진과 모델을 사용할 수도 있다.

```bash
KATAGOMO_ENGINE=/absolute/path/to/katago \
KATAGOMO_MODEL=/absolute/path/to/zhizi_renju28b_s1600.bin.gz \
KATAGOMO_ANALYSIS_CONFIG=/absolute/path/to/analysis.cfg \
make dev
```

서버 시작 때 모델의 크기, gzip stream, SHA-256을 다시 확인한다.

## 문제 해결

- **Chrome에 이전 화면이 보임:** `/`와 `/static/*`은 서버가 `Cache-Control: no-store`로 보낸다. 그래도 이미 열린 탭이 오래된 자산을 잡고 있으면 서버를 `Ctrl-C`로 종료하고 `make dev`로 다시 시작한 뒤 Chrome에서 `Cmd-Shift-R`로 강력 새로고침한다.
- **Chrome에서 연결되지 않음:** `http://127.0.0.1:8000`을 직접 열고 터미널의 서버 시작 메시지를 확인한다. 다른 포트를 사용했다면 주소도 같은 포트로 바꾼다.
- **`session_busy`:** 연결 실패가 아니라 다른 탭이 실제 분석 lease를 사용 중이라는 뜻이다. 오래된 탭을 닫거나 진행 중 분석을 끝낸 뒤 다시 시도한다. idle 탭은 여러 개 연결할 수 있다.
- **모델 오류:** `make verify-model`로 크기, SHA-256, gzip stream을 확인하고 `make smoke`로 실제 모델 로딩을 확인한다.
- **helper 누락/오류:** `make forbidden-helper`를 실행한다. helper가 정상화되기 전에는 가짜 금수·종국 값으로 대체하지 않는다.
- **CPU 엔진 누락:** `make engine`을 실행한다.
- **OpenCL `CL_INVALID_VALUE` 또는 모델 로딩 실패:** OpenCL opt-in 환경변수를 제거하고 CPU/Eigen으로 돌아간다.
- **포트 충돌:** `KATAGOMO_PORT=8001 make dev`처럼 다른 포트를 사용한다.
- **엔진 로그:** `artifacts/stage2/engine-stderr.log`와 `artifacts/stage2/engine-invalid-stdout.log`를 확인한다.

## 테스트

```bash
make test
make integration-test
```

`make test`는 JavaScript 문법·상태·기록 규칙과 Python 단위·프로세스·API/WebSocket 테스트를 실행한다. `make integration-test`는 mock이 아닌 CPU/Eigen KataGomo 엔진과 공식 모델로 실제 분석을 수행한다.

GitHub Actions의 일반 CI는 macOS와 Python 3.11/3.14에서 웹·Python·공식 helper 테스트를 실행한다. 257 MiB 모델 다운로드와 전체 CPU 엔진 빌드가 필요한 실엔진 통합 테스트는 Actions 화면에서 수동으로 실행한다.

추가 진단 명령:

```bash
make benchmark
make benchmark-threads
make compare-visits
make dev                  # 별도 터미널에서 유지
make websocket-smoke
```

> 최종 회귀 기록(2026-09-01): JavaScript 문법 검사와 웹 상태·저장·DOM 테스트 79 passed, Python 테스트 190 passed / 2 deselected, 실제 CPU/Eigen 엔진·공식 모델 통합 테스트 2 passed / 190 deselected.

## 배포 파일과 라이선스

이 저장소의 로컬 서버, UI, build adapter와 테스트는 [MIT License](LICENSE)로 배포한다. 외부 구성요소와 모델 출처는 [Third-party notices](THIRD_PARTY_NOTICES.md)를 확인한다.

보안 문제와 로컬 전용 신뢰 경계는 [Security policy](SECURITY.md)를 확인한다.

다음 파일은 Git에 커밋하거나 이 프로젝트의 산출물로 재배포하지 않는다.

- `vendor/KataGomo/` 공식 엔진 checkout
- `models/*.bin.gz` 신경망 가중치
- `build/` 엔진과 helper 빌드 결과
- `artifacts/`, `logs/`, `*.log` 실행·분석 로그
- `.venv/`, `node_modules/` 로컬 의존성

`make engine`과 `make model`이 사용자의 컴퓨터에서 공식 소스와 공식 릴리스 자산을 직접 가져온다. 모델의 URL과 무결성 메타데이터만 `models/MANIFEST.json`에 추적한다. 가중치에는 별도 라이선스가 명시되지 않았으며 이 프로젝트는 모델에 대한 권리를 부여하지 않는다. KataGomo, KataGo와 모델 저자는 이 UI와 제휴하거나 이를 보증하지 않는다.

---

<details>
<summary><strong>검증 및 기술 세부사항 펼치기</strong></summary>

## 검증 및 기술 세부사항

아래 내용은 개발·재현·감사를 위한 기록이다. 처음 사용하는 경우 위의 설치와 실행 절차만 따르면 된다.

### 공식 소스와 고정 버전

- [KataGomo 저장소 `Gom2024`](https://github.com/hzyhhzy/KataGomo/tree/Gom2024)
- [Gomoku_20250206 릴리스](https://github.com/hzyhhzy/KataGomo/releases/tag/Gomoku_20250206)
- [Analysis Engine 문서](https://github.com/hzyhhzy/KataGomo/blob/Gom2024/docs/Analysis_Engine.md)
- 사용 엔진 커밋: [`df152116e3787c75c6a3de099d261ca092b7dfc1`](https://github.com/hzyhhzy/KataGomo/commit/df152116e3787c75c6a3de099d261ca092b7dfc1)

공식 소스는 지정 커밋에 고정된 clean checkout으로 유지한다. 프로젝트 쪽 CMake target과 helper만 공식 translation unit에 링크한다.

### 검증 호스트

2026-08-31(KST)에 실제 명령으로 확인했다. 일련번호와 UUID 같은 장치 식별자는 기록하지 않았다.

| 항목 | 확인 결과 |
|---|---|
| 장치 | MacBook Pro (`Mac17,2`) |
| 아키텍처 | Apple Silicon, `arm64` |
| SoC / CPU | Apple M5, 10코어(성능 4 + 효율 6) |
| GPU | Apple M5 내장 GPU, 10코어; 시스템 Metal 지원 |
| 메모리 | 24 GB |
| macOS | 26.6.2, build `25G83`, Darwin `25.6.0` |
| Homebrew | 최초 6.0.19, 패키지 설치 후 6.0.20, `/opt/homebrew` |
| CMake | 최초 미설치 → Homebrew 4.4.3 |
| C++ compiler | Apple Clang 21.0.0, ARM64 target |
| Command Line Tools | `/Library/Developer/CommandLineTools` |
| Eigen | 최초 미설치 → Homebrew 5.0.1 |
| zlib | macOS SDK 1.2.12 |
| libzip | 미설치; 분석/GTP에는 선택 사항 |
| Git | Apple Git 2.50.1 |
| Python | 기존 CPython 3.14.6 (`/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`) |
| 프로젝트 venv | `.venv`, CPython 3.14.6, pip 26.1.2, system site-packages 미사용 |
| Node / npm | Node 24.18.0 / npm 11.16.0 |
| jq | 1.8.2, 기존 설치됨 |
| Ninja / pkg-config | 미설치; Makefile 빌드에는 불필요 |

새로 설치한 native package는 `cmake`(67.2 MB)와 `eigen`(10.2 MB)이었다. jq와 Python은 기존 환경을 재사용했다.

| Python 패키지 | 검증 버전 |
|---|---:|
| FastAPI | 0.141.1 |
| Uvicorn | 0.52.4 |
| websockets | 17.1 |
| Starlette | 1.6.0 |
| Pydantic | 2.13.5 |
| httpx2 | 2.12.0 |
| pytest / pytest-asyncio | 9.1.1 / 1.4.0 |

CPython 3.14.6에서 설치, import, 서버 기동, WebSocket과 테스트까지 실제로 통과했으며 Python 호환성 문제는 발견되지 않았다. `requirements-lock.txt`는 이 호스트에서 검증한 direct/transitive 패키지를 고정하고, `requirements.txt`와 `requirements-dev.txt`는 직접 의존성 목록으로 유지한다.

### CPU/Eigen 빌드

확인한 실행 파일 정보:

```text
KataGo v1.12.4
Git revision: df152116e3787c75c6a3de099d261ca092b7dfc1
Using Eigen(CPU) backend
Compiled to allow boards of size up to 15
```

`build/engine-eigen/katago`는 `Mach-O 64-bit executable arm64`이며 macOS의 `libz`, `libc++`, `libSystem`에 동적 링크된다. 빌드는 공식 소스를 수정하지 않는 out-of-source 방식이다.

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

Apple Silicon에는 AVX2가 없어 껐다. Homebrew Eigen 5의 CMake package가 오래된 CMakeLists의 `EIGEN3_INCLUDE_DIRS`를 채우지 않아 include 경로를 명시했다.

고정 커밋의 [CMake 백엔드 목록](https://github.com/hzyhhzy/KataGomo/blob/df152116e3787c75c6a3de099d261ca092b7dfc1/cpp/CMakeLists.txt#L28-L100)은 `CUDA`, `TENSORRT`, `OPENCL`, `EIGEN`뿐이다. Metal option과 구현 파일은 없다. CUDA/TensorRT는 NVIDIA 전용이므로 Apple M5 네이티브 선택지가 아니다. 최신 일반 KataGo의 Metal 코드는 Swift, CoreML/MPSGraph와 새 CMake 구조를 함께 사용하므로 옵션 한 줄을 옮기는 작업이 아니며 이 프로젝트에서는 포팅하지 않았다.

### 모델 무결성

| 항목 | 값 |
|---|---|
| 파일 | `models/zhizi_renju28b_s1600.bin.gz` |
| 공식 자산 | [직접 다운로드](https://github.com/hzyhhzy/KataGomo/releases/download/Gomoku_20250206/zhizi_renju28b_s1600.bin.gz) |
| 파일 크기 | 269,873,929 bytes |
| SHA-256 | `5aa1381aa37ba1b724469c5c8df3b59177079f5c57b355856e144b8146581f6f` |
| gzip 원본 크기 | 291,522,074 bytes |
| 모델 버전 | 102 |
| 로딩된 모델 이름 | `zhizigo_renju28b-b28c512nbt-s1617930240-d2051476833` |
| 릴리스 대상 커밋 | `9cb3546a8107ff0547def7d9d9a367de6c997355` |

GitHub release asset metadata에는 digest가 없어 SHA-256은 다운로드 후 로컬에서 계산했다. 크기, gzip 무결성, SHA-256, 압축 해제 헤더와 엔진 로딩 로그를 각각 확인했다. 릴리스 본문은 `b28c512nbt`와 Renju/Freestyle/Standard/Caro를 명시하고, 독립 자산명과 엔진의 모델 이름에도 `renju28b`가 들어간다. 일반 바둑용 b28 모델은 사용하지 않았다. 전체 메타데이터는 `models/MANIFEST.json`에 있다.

### CPU benchmark

조건은 15×15 빈 시작 포지션, 공식 `benchmark` 명령, Eigen, `nnRandomize=false`, 단일 포지션, b28c512nbt다. `benchmarks/empty-15.sgf`에서 첫 수 직전 빈 판을 결정적으로 선택했다.

100 visits thread 비교:

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

모델 초기화 시간은 검색 시간에 포함하지 않았고 로그상 약 3~4초였다. 이는 한 Mac에서 보존한 단일 실측값이며 추정치가 아니다. 10-thread sweep은 평가가 한 Eigen server에 몰려 4.80 visits/s로 급락했으며 더 좋은 값으로 바꾸지 않았다. 같은 8-thread 100 visits도 별도 실행에서는 21.68 visits/s였으므로 짧은 검색에는 실행 간 변동이 있다.

원문은 `artifacts/stage1/benchmark/*.log`에 생성된다. Gom2024의 benchmark 구현은 SGF rule을 무시하고 내부 `Rules::getTrompTaylorish()`를 사용하며 여기서는 Freestyle 기본값이다. 따라서 이 표는 같은 15×15 네트워크와 MCTS 처리량 측정이지 Renju 규칙 품질 측정이 아니다. 기본 내장 SGF는 Gomoku에서 중간 종국 뒤 수가 이어져 `Illegal move in SGF`로 실패했고 별도 합법 시작 SGF를 사용했다. 실제 Renju 계약은 smoke와 통합 테스트로 검증한다.

### OpenCL 역사적 측정과 현재 상태

고정 소스에는 [OpenCL CMake 경로](https://github.com/hzyhhzy/KataGomo/blob/df152116e3787c75c6a3de099d261ca092b7dfc1/cpp/CMakeLists.txt#L328-L346)와 [Apple 전용 헤더 경로](https://github.com/hzyhhzy/KataGomo/blob/df152116e3787c75c6a3de099d261ca092b7dfc1/cpp/neuralnet/openclincludes.h#L4-L12)가 있다.

2026-08-31 네이티브 실행에서는 Apple M5 GPU(`CL_DEVICE_TYPE_GPU`, type `0x4`)와 Apple OpenCL 1.2 platform을 열거하고, 같은 모델 로딩, `B H8, W H9` 15×15 Renju 분석과 100/500 visits benchmark까지 모두 성공했다.

| Visits | CPU/Eigen | OpenCL | CPU 검색 시간 | OpenCL 검색 시간 | 당시 배속 |
|---:|---:|---:|---:|---:|---:|
| 100 | 21.68 visits/s | 95.68 visits/s | 4.9 s | 1.1 s | 4.41× |
| 500 | 22.51 visits/s | 90.24 visits/s | 22.5 s | 5.6 s | 4.01× |

첫 성공 실행은 약 40초 autotune 뒤 FP32 storage/compute로 동작했다. `nnMaxBatchSize=8`이 필요했고 FP16/tensor 경로는 `cl2Metal failed` 후 정상적으로 비활성화됐다. tuning 결과는 `artifacts/runtime/opencl/opencltuning/`, configure/build/device/model/analysis/benchmark 원문은 `artifacts/stage1_5/opencl/`에 남겼다.

그러나 같은 Apple M5의 최신 재실행에서는 OpenCL 장치 열거가 `CL_INVALID_VALUE`로 실패해 모델 로딩과 Renju 분석까지 도달하지 못했다. 제한된 실행 환경에서도 같은 오류가 있었고, 이제 네이티브 재실행에서도 재현되었으므로 이 백엔드를 안정적인 기본으로 간주하지 않는다. 과거 성능 수치는 삭제하거나 성공으로 일반화하지 않고 역사적 측정으로만 보존한다. Apple은 OpenCL을 deprecated로 표시하고 있어 현재 정책은 **CPU/Eigen 기본, OpenCL 명시적 opt-in**이다.

### 실제 15×15 Renju JSON

Stage 1 smoke 위치는 `B H8, W H9` 다음 흑 차례다. 문자열 `"RENJU"`가 아니라 Gom2024가 파싱하는 규칙 객체를 보낸다.

```json
{"id":"stage1-renju-100","moves":[["B","H8"],["W","H9"]],"rules":{"basicrule":"RENJU","vcnrule":"NOVC","firstpasswin":false,"maxmoves":0},"boardXSize":15,"boardYSize":15,"maxVisits":100,"analysisPVLen":8,"includePolicy":true,"reportDuringSearchEvery":1.0,"overrideSettings":{"reportAnalysisWinratesAs":"BLACK","wideRootNoise":0.0,"rootSymmetryPruning":false}}
```

실제 실행에서 중간 응답 5개와 최종 응답 1개가 stdout JSONL로 왔고 stderr에는 엔진 로그만 왔다. policy는 모든 응답에서 `15×15+pass = 226`개였다. 최종 응답 일부:

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

전체 원본은 `artifacts/stage1/analysis-response.jsonl`에 있다. H8/H9 policy index는 `-1`, G9 Raw policy는 `0.158203125`였다. root visits 107이 설정 100보다 큰 것은 8 search threads의 진행 중 평가로 생긴 overshoot다. 재실행 시 visits 배분과 winrate 마지막 자릿수는 달라질 수 있으므로 검증은 숫자 하나가 아니라 필드, policy 길이와 중간/최종 계약을 확인한다.

`config/analysis.cfg`는 `reportAnalysisWinratesAs=BLACK`, `wideRootNoise=0.0`, `rootSymmetryPruning=false`다. `moveInfos[].prior`는 search prior로 별도 보존하며 UI의 Raw policy는 반드시 전체 `policy[coordinateIndex]`에서 읽는다.

### 분석 서버 계약

FastAPI lifespan 동안 KataGomo analysis 자식 프로세스 하나를 유지한다.

- 시작 때 `query_version`으로 준비 상태 확인
- stdout JSON Lines와 stderr 로그 분리
- 요청별 공개 UUID와 별도 engine ID
- 같은 연결의 새 요청은 현재 engine ID에 `terminate`를 보내고 대체
- 취소 뒤 늦은 응답은 active ID와 process generation으로 무시
- `isDuringSearch`와 `isFinal` 구분
- 비정상 종료 감지 후 한 번만 재시작
- 종료 시 active request 취소, `terminate_all`, stdin EOF 순으로 정리
- 여러 idle WebSocket 허용, 실제 분석 lease는 전역 하나

기본 요청은 15×15 Renju, `maxVisits=100`, `includePolicy=true`, `includePVVisits=true`, `reportDuringSearchEvery=0.5`이며 승률 원시 계약은 항상 BLACK이다.

| 경로 | 용도 |
|---|---|
| `GET /api/status` | engine PID/state/restart/stale, active lease, 연결 수, helper, Python 상태 |
| `POST /api/position` | 공식 합법·금수·종국 판정 |
| `POST /api/legality` | `/api/position`의 이전 클라이언트용 호환 alias |
| `GET /api/training/options` | 종료 수와 채점 계약 |
| `POST /api/training/evaluate` | 사용자 한 수 평가 |
| `POST /api/training/summary` | 충분히 분석된 수 중 큰 실수 최대 3개 |
| `WS /ws/analysis` | 분석 시작·취소와 중간/최종 스트림 |

분석 전에 position helper를 먼저 호출한다. 종국 수순은 engine이나 lease를 사용하지 않고 WebSocket `type=position`, `code=position_terminal`, `gameState`를 반환한다. 요청 schema, 흑백 교대나 중복 좌표 오류는 REST `422` 또는 WebSocket `validation_error`다. schema는 통과했지만 공식 helper가 의미상 잘못된 수순으로 판정하면 REST `422` 또는 WebSocket `invalid_position`, helper 자체를 실행할 수 없으면 REST `503` 또는 WebSocket `position_validation_unavailable`이다.

로컬 진단 예:

```bash
curl -s http://127.0.0.1:8000/api/status
curl -s -X POST http://127.0.0.1:8000/api/position \
  -H 'Content-Type: application/json' \
  -d '{"moves":[["B","D8"],["W","A1"],["B","E8"],["W","C1"],["B","F8"],["W","E1"],["B","G8"],["W","G1"],["B","H8"]],"nextPlayer":"W"}'
```

두 번째 응답은 `isTerminal=true`, `winner="B"`, `outcome="black_win"`, `terminalReason="line_win"`, `terminalMove="H8"`이다. 여기에 종국 뒤 수를 추가하면 `422`로 거부된다.

최신 CPU/Eigen WebSocket 500-visits smoke에서 받은 실제 변환 응답 일부는 다음과 같다. 전체 원문은 `artifacts/stage3/websocket-response.jsonl`에 생성된다.

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
    "move": "K8",
    "order": 0,
    "rawPrior": 0.0771484375,
    "visits": 52,
    "visitShare": 0.10276679841897234,
    "blackWinrate": 0.974332779,
    "pv": ["K8", "G8", "J10", "G9", "G7", "J9", "K9", "K7", "L8", "M7", "F9", "H11"]
  },
  "rootInfo": {
    "visits": 507,
    "blackWinrate": 0.967879642
  }
}
```

### Position helper 검증

helper 응답은 `source="KataGomo Board::isForbidden()"`와 `historySource="KataGomo BoardHistory::makeBoardMoveAssumeLegal()"`를 함께 기록한다. 흑 착수 직전 `isForbidden()`은 BoardHistory가 저장하지 않는 `black_forbidden` 사유를 보존하는 데도 사용한다. 백에게 흑 금수 규칙을 적용하지 않고, `policy=-1`을 합법성 근거로 사용하지 않는다.

금수 fixture는 RIF/RenjuNet의 [공식 규칙](https://www.renju.net/rifrules/), [고급 교육 자료](https://www.renju.net/advanced/), [금수 도해](https://www.renju.net/upload/staticfiles/forbiddens.jpg)에 근거한다. 국소 패턴을 KataGomo 좌표로 정규화하고 교대 수순용 비간섭 filler를 더한 변환 내역은 fixture의 `provenance`에 기록했다.

검증 행렬은 다음을 포함한다.

- 흑·백 5목과 백 장목 승리
- 흑 장목, 3×3, 4×4 금수패
- 정확한 5목 우선
- 가짜 열린 3
- 백에게 흑 금수 미적용
- 일반 합법 수
- 224수 진행 중과 공식 경로로 검증한 225수 full-board 무승부
- 종국 뒤 추가 수 거부
- API 전체 position response contract

### 100 vs 500 visits 후보 분포

같은 `B H8, W H9` 포지션을 persistent CPU/Eigen 프로세스에서 연속 분석한 기록이다.

| 항목 | 100 visits | 500 visits |
|---|---:|---:|
| 요청 포함 경과 | 5.383 s | 17.924 s |
| 중간 응답 | 10 | 35 |
| root visits | 107 | 507 |
| 후보 수 | 14 | 17 |
| 후보 visits 합 | 106 | 506 |
| Engine Order 상위 5 | G9, J9, K8, F8, G10 | G9, J9, K8, F8, J10 |
| Visits 상위 5 | J9, G9, K8, F8, G10 | J9, G9, K8, F8, J10 |

Raw policy 상위 5는 둘 다 `J9, G9, K8, F8, G10`이었다. 500 visits에서는 MCTS 5위가 `J10`으로 달라졌다. 100 visits에서 `moveInfos`가 하나뿐이라는 과거 인상은 JSON 예시가 첫 후보만 발췌했기 때문이며 실제 최종 후보는 14개였다. 원본 비교는 `artifacts/stage2/candidate-distribution/comparison.json`에 생성된다.

### 수 비교 실험 실제 검증

`B H8, W G7, B G9, W J7` 다음 흑 차례에서 공식 helper가 `F9`와 `H6`를 모두 합법으로 판정한 뒤, 한 persistent CPU/Eigen 엔진에서 기준→F9→H6을 각각 100 visits로 순차 분석했다. 세 요청 모두 검색 중 응답과 최종 응답, 226개 policy를 반환했고 엔진 시작 횟수는 1회였다.

| 지표 | F9 | H6 |
|---|---:|---:|
| 착수 전 Raw policy | 60.15625% | 0.007629% |
| 착수 전 MCTS Order / Visits | Order 0 / 31 | Order 8 / 1 |
| 착수 후 Winrate (Black) | 96.539% | 5.289% |
| 착수 후 Root visits | 107 | 107 |
| 상대 Order 0 | F7 | H7 |

이 값은 2026-09-01의 한 실측이며 재검색 시 visits 배분과 승률은 달라질 수 있다. 테스트는 F9 우위 같은 특정 숫자를 정답으로 고정하지 않고, 동일 예산·메타데이터·중간/최종 응답·policy·상대 Order 0/PV 계약을 검증한다. 원본 요약은 통합 테스트 실행 때 `artifacts/comparison-lab/integration-f9-vs-h6.json`에 생성된다.

### 채점 계약

절대적인 0~100 점수를 만들지 않는다. 사용자 수 직전의 최종 분석과 착수 직후 결과에서 다음을 보존한다.

- 사용자 Raw policy와 공식 합법 수 중 policy 순위
- 사용자 수와 추천 수의 visit 순위 및 차이
- `order=0` 추천 수와 사용자 수
- 사용자 관점 착수 전/후 winrate 변화와 추천 수 대비 차이
- pre/post Root visits와 후보 visits 합

Order는 Visits 순위와 다를 수 있다. 보존된 CPU 비교에서 `G9`는 `order=0`이지만 13 visits, `J9`는 `order=1`이지만 14 visits였으므로 두 값을 분리한다. pre 분석이 최종이 아니거나 후보 visits 합, pre Root visits, post Root visits 중 하나가 기준 50보다 적거나, 사용자 수가 MCTS 후보에 없거나, policy/legality 계약이 불완전하면 `분석 부족`으로 표시하고 확정적인 실수 순위에서 제외한다.

사용자 수가 공식 종국을 만들면 post-search를 꾸미지 않는다. `terminalState`의 승자에서 사용자 관점 1.0/0.0, 무승부 0.5를 만들고 `afterUserWinrateSource="official-terminal-result"`, `postRootVisits=null`, `terminalOutcome`, `terminalReason`을 기록한다. 진행 중 위치는 실제 `postRootInfo`와 `afterUserWinrateSource="engine-post-root"`를 사용한다.

각 WebSocket 요청과 REST 평가는 session epoch, position revision, client request ID를 사용한다. Reset, Undo, 취소나 연결 종료 뒤 도착한 stale WS/REST/timer 결과를 현재 판에 적용하지 않는다.

### 실제 실행 검증 기록

- 실행 재현성 체크포인트에서는 `make setup`, `make source`, `make verify-model`, `make engine`, `make forbidden-helper`, `make smoke`, `make test`, `make integration-test`를 순서대로 다시 실행했다. 기존 CPython 3.14.6을 재사용했고 새 Python을 설치하지 않았다.
- 실제 Eigen 엔진·공식 모델 통합 테스트는 `B H8, W H9`를 분석하고 실제 추천 수를 한 수 더 둔 뒤 다시 분석한다. 중간/최종 응답과 prior, visits, winrate, PV, policy, helper legalMoves와 수별 평가를 확인한다.
- 과거 OpenCL 500-visits WebSocket smoke는 중간 11개, 최종 1개, policy 226개, 후보 17개와 request identity echo를 확인했다.
- 잘못된 WebSocket 수순에 `validation_error`를 받은 뒤 같은 연결에서 정상 분석을 계속할 수 있음을 확인했다.
- 별도 CPU/Eigen, 외부 동일 모델, `KATAGOMO_PORT=8011` 실행에서는 중간 44개, 최종 1개, policy 226개, 후보 17개를 받고 `All cleaned up, quitting` 종료 로그까지 확인했다.
- 이전 UI 체크포인트의 실제 브라우저에서 14수 흑 연습, AI 7수 자동 착수, 사용자 7수 평가, 결과표, 완료 후 착수 차단, 당시 localStorage 저장·복원과 백 연습의 AI 선착수를 확인했다. 모든 사용자 수가 실제 서버 평가를 받았고 당시 console error는 없었다.
- 같은 이전 체크포인트에서 14수 판을 제한 없음으로 이어 16수까지 실제 분석·AI 응수 후 직접 종료했고, 기존 14수와 새 16수 기록이 각각 보존됨을 확인했다.
- 같은 이전 체크포인트에서 금수 3×3 fixture의 M5 표시와 클릭 차단을 실제 브라우저로 확인했다.
- 2026-09-01 데스크톱 리뉴얼은 Chrome에서 왼쪽 보드와 오른쪽 단일 작업대 구조를 시각 점검했다. 실제 빈 보드 100 visits 분석, MCTS/Raw policy 전환, 수 비교 선택·취소·완료·PV, 실행 중 탭 이탈 차단, 기록 목록/복기 전환을 확인했다. 비교 탭을 닫으면 가상 A/B 상태를 폐기하고 라이브 보드 착수를 다시 허용한다.
- 같은 실행 서버의 500-visits WebSocket smoke는 중간 44개, 최종 1개, policy 226개, 후보 17개를 받았다. 실제 HTTP에서는 정상 loopback Host 200, 악성 Host 400, 악성 WebSocket Origin 403, 정적 자산 `Cache-Control: no-store`를 확인했다.

주요 생성 원문은 `artifacts/stage1/analysis-response.jsonl`, `artifacts/stage2/integration-response.jsonl`, `artifacts/stage2/candidate-distribution/`, `artifacts/stage3/websocket-response.jsonl`, `artifacts/stage3/integration-training-response.jsonl`에 저장한다. 모두 재생성 가능한 로컬 산출물이므로 Git에서는 제외한다.

중간 응답 수와 visits 분배는 실행 스케줄링에 따라 달라진다. 브라우저 E2E 전용 자동 러너는 아직 없으며 상태/저장/상호작용 로직 단위 테스트, Python API/통합 테스트와 실제 Chrome 검증을 함께 유지한다.

### 체크포인트

| 커밋 | 내용 |
|---|---|
| `7c26cbc` | Stage 1 엔진·모델·실분석 검증 |
| `4786773` | Stage 2 persistent 분석 서버 |
| `8bf988b` | 반복 연습 UI와 채점 |
| `d8e617d` | 실행 재현성 검증 |
| `1cd61a8` | 데스크톱 Renju 연습 플랫폼 |

각 체크포인트는 모델, 빌드 산출물, 로그, `.venv`, `vendor/`를 포함하지 않는다. 공식 KataGomo checkout은 지정 커밋에서 clean 상태로 유지했다.

### 확인된 호환성 문제

1. upstream `Compiling.md`의 CMake/C++ 요구사항은 오래됐고 실제 CMakeLists는 CMake 3.18.2와 C++17을 요구한다.
2. Apple용 CMake가 `/usr/local/include`를 무조건 추가해 Apple Silicon의 실제 Homebrew prefix `/opt/homebrew`와 어긋나는 경고가 난다.
3. Eigen 5는 발견되지만 오래된 CMake 코드가 include 변수를 받지 못해 `EIGEN3_INCLUDE_DIRS`를 명시해야 했다.
4. 일부 중국어 주석이 UTF-8이 아니어서 최신 Apple Clang이 많은 `invalid UTF-8 in comment` 경고를 내지만 컴파일 결과에는 영향이 없었다.
5. libzip 미설치로 self-play 학습 데이터 쓰기는 비활성화됐다. analysis/GTP에는 필요하지 않다.
6. Metal backend는 없고 OpenCL은 deprecated이며 최신 재실행에서 `CL_INVALID_VALUE`가 발생했다.
7. 상속된 Analysis 문서의 Go 예시와 Gom2024 구현이 일부 다르다. Renju는 JSON rules object가 필요하고 score/ownership 계열 값은 현재 응답에 없다.
8. `policy=-1`은 점유/기본 mask일 수 있지만 Renju 흑 금수나 종국의 권위 있는 값이 아니다.

### 프로젝트 구조

```text
config/                         CPU/OpenCL analysis 및 benchmark 설정
native/forbidden_helper/        공식 BoardHistory + Board::isForbidden() adapter
server/                         FastAPI, persistent engine, position, 변환, 채점
web/                            데스크톱 Renju 연습·분석 UI
tests/                          JS/Python 단위·프로세스·실엔진 통합 테스트
scripts/                        소스·모델·빌드·실행·smoke·benchmark 스크립트
benchmarks/                     CPU benchmark용 15×15 시작 SGF
smoke/                          실제 Renju analysis JSONL 요청
models/MANIFEST.json            공식 모델 URL과 무결성 metadata
artifacts/                      실행 시 생성되는 검증 원문과 로그, Git 제외
vendor/KataGomo/                공식 clean checkout, Git 제외
build/engine-eigen/             CPU/Eigen 실행 파일, Git 제외
build/engine-opencl/            opt-in OpenCL 실행 파일, Git 제외
models/*.bin.gz                 모델 본체, Git 제외
```

</details>
