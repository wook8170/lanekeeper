# 문제 해결

Lanekeeper 의 훅이 작업을 막거나 명령이 예상과 다르게 끝났을 때 원인과 해결 방법을 정리했다. 메시지 문구로 찾을 수 있도록 실제 출력의 앞부분을 제목처럼 적었다.

## 1. 먼저 확인할 것

막힌 이유를 모를 때는 다음 세 명령을 차례로 실행한다.

```
lanekeeper-explain                     지금 막힌 것과 기다리는 것
lanekeeper-explain code <메시지 코드>   차단 메시지 뒤의 규칙과 복구 방법
lanekeeper-config doctor               설정 오류와 주요 값의 출처
```

Claude Code 안에서는 `/lanekeeper:explain` 과 `/lanekeeper:doctor` 가 같은 일을 한다. 차단 메시지는 「막은 이유 · 고치는 법 · 물어볼 곳」 세 줄로 나온다. 그중 둘째 줄의 방법을 먼저 따른다. 규칙별 설명은 [규칙 안내](04-rules.md)에 있다.

## 2. 메시지별 해결

### 서브에이전트를 보낼 때

| 메시지 | 원인 | 해결 |
|---|---|---|
| `model 이 지정되지 않았습니다. 작업 종류 … 의 라우팅 결과는 … 입니다` | Agent 호출에 `model` 이 없다 | 메시지에 나온 모델을 지정한다 |
| `model … 은 작업 종류 … 의 바닥선 … 보다 낮습니다` | 최소 등급보다 낮은 모델을 골랐다 | 메시지에 나온 모델을 쓴다. 작업 종류가 다르면 지시서 표지의 `type=` 을 고친다 |
| `model … 은 금지 목록(routing.denied)에 있습니다` | 개인 설정에서 금지한 모델이다 | 대체 순서의 다음 모델을 쓴다. 금지를 풀려면 `~/.lanekeeper/routing.json` 의 `denied` 에서 지운다 |
| `… 사용량 한도가 소진됐습니다` · `리셋 시각 … 까지 대기합니다` | 최소 등급 이상의 모델이 모두 한도에 걸렸다 | 리셋 뒤 다시 보낸다. 최소 등급 아래로 내리지 않는다 |
| `지시서 표지(<!-- lanekeeper-brief v1 …-->)가 없습니다` | 프롬프트 첫 줄에 표지가 없다 | `templates/briefs/` 틀로 지시서를 만든다. 지시서 파일 경로를 프롬프트에 적어도 된다 |
| `지시서에 채우지 않은 자리 {{…}} 가 남아 있습니다` | 틀의 자리 표시를 채우지 않았다 | `lanekeeper-style brief … --var 이름=값` 으로 채우고 `lanekeeper-check brief <파일>` 로 확인한다 |
| `지시서에 빠진 항목이 있습니다` | 필수 절(목표·범위·금지·시험 규칙·보고 위치·커밋 규칙)이나 헤드리스·전체 시험 금지·기준 커밋 문구가 없다 | 틀에서 다시 만든다 |
| `정리하지 않은 레인이 …개로 상한 …개에 도달해` | 동시 레인 수 상한(기본 3)에 닿았다 | 끝난 레인을 `lanekeeper-worktree remove <레인>` 으로 정리한다. 머신 사양이 충분하면 `~/.lanekeeper/machine.json` 의 `lanes.max` 를 올린다 |

### git 명령

| 메시지 | 원인 | 해결 |
|---|---|---|
| `레인은 자기 레인 브랜치(…)에만 커밋할 수 있습니다` | 레인이 다른 브랜치에서 커밋하려 했다 | 자기 레인 워크트리로 가서 커밋한다 |
| `레인은 push 할 수 없습니다` | 레인이 push 하려 했다 | 커밋만 하고 보고한다. push 는 메인 세션이 정한다 |
| `강제 push(--force, --force-with-lease, +refspec)는 누구에게도 허용하지 않습니다` | 강제 push | 원격을 받아 일반 push 로 올린다. 이력을 고쳐야 하면 소유자에게 요청한다 |
| `보호 브랜치 … 에 대한 이 작업(…)은 소유자 허가가 필요한데 허가가 없습니다` | 보호 브랜치 병합·push·커밋 | 소유자가 `/lanekeeper:approve merge-main`(또는 `push-main`, `commit-main`)을 직접 입력한다. push 를 막았을 때 메시지의 브랜치 이름은 대상이 아니라 지금 체크아웃한 브랜치로 나온다 |
| `커밋 … 에 대한 게이트 통과 표식이 없습니다` | `project.gate.command` 가 설정된 프로젝트에서 반영할 커밋으로 게이트를 통과시킨 적이 없다 | 그 커밋을 체크아웃한 폴더(보통 통합 브랜치)에서 `lanekeeper-test-report gate-pass` 나 `lanekeeper-test-report run` 을 끝까지 통과시킨다. 커밋하지 않은 변경이 있으면 표식을 남기지 않는다 |
| `게이트 통과 표식이 다른 커밋(…)의 것입니다` | 표식을 남긴 뒤 결과 파일 말고 다른 변경이 커밋됐다 | 지금 커밋에서 게이트를 다시 돌린다 |
| `검증 게이트가 실행 중입니다` | `lanekeeper-test-report run` 이 게이트 잠금을 잡고 있다 | 끝난 뒤 다시 실행한다. 비정상 종료로 잠금이 남았으면 `lanekeeper-reap --gate-lock` 으로 지운다 |
| `기능 브랜치 push 는 확인 후 진행합니다` | `project.git.feature_push` 가 `ask`(기본) | 확인 창에서 승인한다. 늘 허용하려면 `allow` 로 바꾼다 |
| `` `git reset --hard` 는 커밋하지 않은 변경을 되돌릴 수 없게 지웁니다`` | 변경을 지우는 명령 | `git status` 로 지워질 내용을 확인하고 필요하면 WIP 커밋을 남긴 뒤 승인한다 |

### 프로세스, 삭제, 브라우저, 경로

| 메시지 | 원인 | 해결 |
|---|---|---|
| `이름·패턴으로 프로세스를 끄면(…) 다른 세션이나 소유자의 서버까지 꺼질 수 있습니다` | `pkill`, `killall`, `kill $(pgrep …)` | 자기가 띄운 프로세스의 PID 를 확인해 `kill <PID>` 로 끈다 |
| 보호 포트를 쓰는 프로세스 종료 차단 | `kill <PID>` 대상이 `machine.ports.protected` 포트를 쓴다 | 소유자에게 요청한다 |
| `` `~/` 를 통째로 지우면 홈·시스템·프로젝트 전체가 사라집니다`` | 홈·루트·프로젝트 루트·`.git` 삭제 | 지울 하위 폴더를 정확히 지정한다 |
| `창이 뜨는 브라우저 실행(…)은 새 창을 띄워, 사용 중인 화면의 포커스를 그 창으로 옮깁니다` · `… 는 브라우저 창을 엽니다` | 헤드리스가 아닌 브라우저, `open` | `--headless=new` 를 붙이거나 Playwright 기본(헤드리스)으로 실행하고 결과 파일을 공유한다 |
| `… 는 Lanekeeper 상태 파일(소유자 허가·게이트 표식·레인 대장)입니다` | Claude 가 Lanekeeper 상태 파일을 쓰려 했다 | 허가는 `/lanekeeper:approve`, 원장은 `lanekeeper-waves` 로만 바꾼다 |
| `… 는 보호 경로(…)입니다` | `project.protected_paths` 에 쓰기 | 소유자에게 요청한다 |
| `Lanekeeper 설정에 오류가 있어 안전 판정을 할 수 없습니다` | 설정 파일 형식 오류 | 메시지의 파일과 키를 고치고 `lanekeeper-config validate` 로 확인한다. 고칠 때까지 git 반영·프로세스 종료·삭제·브라우저 실행이 막힌다 |
| 명령 대상을 실행 전에 알 수 없어 막음 | 명령 이름이나 대상 폴더가 변수다 | 변수를 풀어 실제 값으로 적는다 |

### 시안, 인계, 보고

| 메시지 | 원인 | 해결 |
|---|---|---|
| `… 의 UI 구조(요소·선택자)가 바뀌는데 기록된 시안 결정이 없습니다` | 화면 파일 범위의 구조 변경 | 시안을 보여 주고 `lanekeeper-decide new … --kind mockup --scope …` 로 질문을 만든 뒤 `lanekeeper-decide answer` 로 기록한다. 대기 중인 결정은 막힘을 풀지 않는다 |
| `[Lanekeeper 핸드오프] progress.md 마지막 갱신 이후의 작업(…)이 있다` | 턴을 끝내기 전에 인계가 필요하다 | 끝난 내용을 아카이브에 덧붙이고 `progress.md` 를 다시 써서 함께 커밋한다. 사소한 변경이면 이유를 한 줄로 적고 끝낸다 |
| `끝난 작업의 보고가 아티팩트로 게시되지 않았습니다` | `/lanekeeper:report` 를 실행했는데 아티팩트가 없다 | `lanekeeper-art report` 로 HTML 을 만들어 아티팩트로 게시한다. 이 검사를 끄려면 `personal.report.artifact_check` 를 `false` 로 둔다 |
| `최신 검증 결과 엑셀에 문제가 있습니다` | 결과 엑셀이 없거나 커밋되지 않았다 | `lanekeeper-check test-results` 로 확인하고 `/lanekeeper:test-report` 로 다시 만든다 |

### 검수

| 메시지 | 원인 | 해결 |
|---|---|---|
| `8. 시험 결과 — 보고에 시험 결과(통과 수)가 없습니다` | 보고 파일에서 통과 수를 읽지 못했다 | `시험: 통과 12 / 실패 0` 이나 `12 passed` 처럼 통과 수를 적는다 |
| `8. 시험 결과 — 보고에 실패한 시험 …건이 있습니다` | 보고 파일에 지금 실패한 시험 수가 있다. `수정 전 실패 1건` 같은 수정 전 기록은 세지 않는다 | 실패한 시험을 고친 뒤 결과 줄을 갱신한다 |
| `6. 캡처 확인 — UI 변경인데 캡처가 없습니다` | 화면 파일이 바뀌었는데 캡처가 없다 | 레인 보고에 전후 캡처 경로를 적는다. 메인 세션이 캡처를 열어 본 뒤 `--captures-seen` 을 붙인다 |
| `7. 서빙 코드 표식 — … 확인할 주소(--serve-url)와 표식(--marker)이 없습니다` | 웹 화면 변경인데 서빙 확인을 하지 않았다 | 서버를 다시 띄우고 `--serve-url http://127.0.0.1:<포트>/… --marker <이번 변경에만 있는 문자열>` 을 준다. 이 머신 주소만 허용한다 |
| `5. 지시서 범위` 실패 | 지시서의 소유 파일 밖을 바꿨다 | 범위 밖 변경을 되돌리거나 지시서를 고쳐 다시 보낸다 |

### 명령 실행

| 증상 | 원인 | 해결 |
|---|---|---|
| `지시서 파일 … 이 없습니다` | `lanekeeper-check brief` 에 준 지시서 파일이 없다 | 경로를 확인한다. 지시서 폴더 `.lanekeeper/briefs/` 는 init 이 만들지 않으므로 `mkdir -p .lanekeeper/briefs` 로 만든다 |
| `lanekeeper-worktree remove` 가 `… 안에서 프로세스가 돌고 있어 지우지 않았습니다(PID …)` | 그 폴더에서 띄운 서버나 감시 프로세스가 아직 실행 중이다 | 나온 PID 를 하나씩 `kill <PID>` 로 끄고 다시 실행한다 |
| `lanekeeper-worktree remove` 가 `커밋하지 않은 변경이 …건 있습니다` | 미커밋 변경 | 커밋하거나, 버릴 것이 확실할 때만 `--force` 를 붙인다 |
| `lanekeeper-worktree create` 가 `정리하지 않은 레인이 …개라 상한 … 에 닿았습니다` | 레인 상한 | 끝난 레인을 정리한다 |
| `lanekeeper-integrate` 종료 코드 3 | 게이트나 다른 취합이 잠금을 잡고 있다 | 끝난 뒤 다시 실행한다 |
| `lanekeeper-integrate` 종료 코드 2 | 작업 트리가 깨끗하지 않거나 병합 중이거나 브랜치가 없다 | `git status` 로 확인한다 |
| `lanekeeper-slot` 이 `부하가 높아 기다립니다` 를 반복 | 1분 부하가 `machine.load.max` 이상이다 | 다른 무거운 실행이 끝나기를 기다린다. `--timeout <초>` 를 주면 그 시간 뒤 종료 코드 75 로 끝난다 |
| 디스패치가 `새 레인 보류 문턱 … 이상입니다` 로 막힘 | 1분 부하가 `machine.load.tiers.hold_new_lanes` 이상이다 | `lanekeeper-slot check` 로 부하와 고아 프로세스를 본다. 돌고 있는 레인이 끝나 부하가 내려간 뒤 다시 디스패치한다 |
| 디스패치가 `가벼운 작업만 허용 문턱 … 이상입니다` 로 막힘 | 1분 부하가 `machine.load.tiers.light_only` 이상이고 작업 종류의 무게가 `light` 가 아니다 | 설계·검수·문서처럼 가벼운 레인을 먼저 띄우고, 무거운 레인은 부하가 내려간 뒤 디스패치한다. 작업 종류의 무게는 `routing.tasks.<종류>.weight` 다 |
| 레인 커밋이 `지시가 있을 때만 허용합니다` 로 확인 요청 | `project.lanes.commit` 이 `on-instruction` 이고 지시서에 커밋 허용 표식이 없다 | 커밋하지 않고 보고한다. 커밋이 필요하면 메인 세션이 지시서 표지에 `commit=allowed` 를 넣어 다시 디스패치한다 |
| DB 명령이 `보호 데이터(…)에 쓰는 명령입니다` 로 막힘 | 대상이 `project.protected_data` 의 파일·포트·컨테이너다 | 레인 전용 시험 DB(배정 포트·전용 컨테이너·시험용 파일)로 바꾼다. 읽기 질의는 `-c`·`-e` 뒤에 SELECT 문을 직접 적는다 |
| 검수 레인의 무거운 실행이 `무거운 실행 중지 문턱 … 이상입니다` 로 막힘 | 1분 부하가 `machine.load.tiers.stop_heavy` 이상이고 레인 종류가 검수(`verifier`)다 | 부하가 내려간 뒤 다시 실행한다. 고아 프로세스는 `lanekeeper-slot reap --orphans` 로 보고 확인한 뒤 `--kill` 로 그 PID 만 종료한다 |
| `lanekeeper-test-report` 가 `openpyxl 모듈이 없습니다` | Python 모듈이 없다 | Debian·Ubuntu 는 `sudo apt install python3-openpyxl` 을 실행한다. pip 설치가 막힌 환경(Homebrew·Debian 12 이상·Ubuntu 24.04)은 `python3 -m venv ~/.lanekeeper/venv` 후 `~/.lanekeeper/venv/bin/pip install openpyxl` 을 실행하고 `LANEKEEPER_PYTHON=$HOME/.lanekeeper/venv/bin/python3` 를 지정한다. 그 밖의 환경은 `python3 -m pip install openpyxl` 이면 된다. 설치하지 않아도 시험이 통과하면 게이트 통과 표식은 남는다(엑셀만 빠진다) |
| `package.json 에 "gate" 스크립트가 없습니다` | `.lanekeeper/verify.config.json` 의 `gate.script` 이름이 `package.json` 의 `scripts` 에 없다 | 그 스크립트를 추가하거나 `gate.script` 를 있는 이름으로 바꾼다. 또는 `gate.steps` 에 `[{ "name": "test", "cmd": "npm test" }]` 처럼 명령을 직접 적는다 |
| `lanekeeper-worktree create` 가 `이 저장소에는 커밋이 하나도 없어` 라고 안내 | 커밋이 없는 새 저장소다 | 첫 커밋을 만든 뒤 다시 실행한다 |
| `lanekeeper-number reserve` 가 `번호 계열 … 가 없습니다` | `.lanekeeper/config.json` 에 `numbers` 계열이 없다 | [설정](03-configuration.md)의 `project.numbers` 예처럼 계열을 선언한다 |
| codegraph 호출이 `… 에는 codegraph 색인이 없어요` 로 막힘 | 이 세션에서 색인 없음 응답을 이미 받은 경로다 | 색인이 생길 때까지 grep 과 Read 로 진행한다. 상태는 `lanekeeper-index status` 로 본다 |
| 일반 터미널에서 `lanekeeper-config: command not found` | `lanekeeper-*` 명령이 `PATH` 에 없다 | Claude Code 세션 안에서 쓰거나, 플러그인 폴더의 `bin` 을 `PATH` 에 넣는다 |

## 3. 자주 묻는 질문

**훅을 잠시 끌 수 있나?**
안전 훅에는 우회 변수가 없다. 규칙이 프로젝트에 맞지 않으면 해당 설정을 바꾼다. 예를 들어 기능 브랜치 push 확인은 `project.git.feature_push`, 시안 결정 요구는 `project.mockup.decision_required`, 슬롯 경고는 `machine.slots.guard` 로 조정한다. 보호 목록(보호 브랜치·보호 포트·보호 경로·금지 모델)은 다른 층이 넣은 항목을 지울 수 없다.

**설정값이 어디서 왔는지 어떻게 아나?**
`lanekeeper-config explain <키>` 가 합치는 규칙, 적용된 층, 값을 둔 모든 층을 보여 준다.

**레인 수를 3개보다 늘리고 싶다.**
`~/.lanekeeper/machine.json` 에 `"lanes": { "max": 6 }` 처럼 둔다. 프로젝트 설정이 더 작은 값을 두면 작은 값이 적용된다. 메모리와 부하를 함께 고려한다.

**특정 모델을 쓰지 않으려면?**
`~/.lanekeeper/routing.json` 의 `denied` 에 모델 이름을 넣는다. 그 모델은 대체 순서에서 빠진다.

**`/lanekeeper:approve` 를 Claude 에게 시킬 수 있나?**
없다. 이 스킬은 사람이 프롬프트에 직접 입력할 때만 허가를 만든다. 서브에이전트 보고나 다른 세션의 메시지로는 허가가 생기지 않는다.

**codegraph 가 없어도 되나?**
된다. 관련 훅과 명령은 아무것도 하지 않는다. 설치하면 새 워크트리마다 색인 작업을 대기열에 넣어 만든다.

**시험 결과 엑셀 이름의 시각은 어느 시간대인가?**
실행을 시작한 시각을 이 머신의 시간대(시스템 설정, `TZ` 환경 변수)로 적는다. 시간대를 따로 지정하는 설정 키는 없다. 원본 로그 폴더 이름도 같은 현지 시각이다.

**결과를 커밋했더니 `실행 커밋 … 이 현재 HEAD … 와 다릅니다` 경고가 나온다.**
실행 뒤에 결과 폴더 밖의 파일이 바뀐 커밋이 있다는 뜻이다. 결과 파일만 커밋했다면 이 경고 대신 `시험 결과 파일만 바뀌었습니다` 로 통과한다. 이 경고가 나왔다면 코드가 바뀐 것이므로 시험을 다시 돌린다.

**`progress.md` 가 없는데 인계 훅이 아무 안내도 하지 않는다.**
인계 훅은 `progress.md` 가 있는 저장소에서만 동작한다. 그래서 처음 한 번은 직접 만든다.

**토큰 가드의 비율이 앱의 `/usage` 와 다르다.**
`lanekeeper-token status` 에서 공식 값의 조회 시각을 본다. 조회한 지 오래됐다면 그 뒤 사용분은 로컬 토큰으로 추정한 값이라 앱과 몇 %p 차이가 날 수 있다. 앱에서 본 값을 `lanekeeper-token calibrate --five <n> --seven <n>` 으로 넣으면 그 시점부터 맞춰진다. 「공식 캐시가 다른 계정 것」이라는 줄이 보이면 계정을 바꾼 뒤 Claude Code 가 아직 사용량을 다시 조회하지 않은 것이다. 프롬프트에서 `/usage` 를 한 번 열면 새 값이 저장된다.

**자동 재개된 세션이 중간에 멈춘다.**
기본 권한 모드(`default`)에서는 승인이 필요한 도구가 무인 실행에서 거절된다. 이때는 `lanekeeper-retry status` 의 `claude --resume <id>` 줄로 세션을 열어 이어서 진행한다.

## 4. 알려진 제한(0.1.0)

| 항목 | 영향 | 지금 할 수 있는 것 |
|---|---|---|
| UI 안정성 점검과 용어 검사 | 이 판에 포함되지 않았다. 설정 키(`project.ui_stability.*`, `project.glossary.terms_scan`·`copy_globs`)는 예약 상태다 | 이후 판에서 추가된다 |
| 안전 훅의 판정 범위 | 스크립트 파일 안의 명령, python·node 로 실행하는 git·kill 호출은 판정하지 않는다 | 위험한 작업을 스크립트로 감싸지 않는다 |
