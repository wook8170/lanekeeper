# wb — 에이전트 작업대

[English](README.en.md)

> 초안이다. 0.1.0 공개 전까지 내용이 바뀐다.

wb 는 Claude Code 에서 여러 서브에이전트 레인을 함께 돌릴 때 필요한 규칙을 설정 파일과 훅으로 관리하는 플러그인이다. 작업 종류에 맞는 모델을 고르고, 동시에 도는 레인과 무거운 실행의 수를 제한하고, 레인이 보호 브랜치에 커밋하거나 다른 작업의 서버를 종료하지 못하게 막는다. 레인이 끝나면 보고 파일과 검수 항목으로 결과를 확인한다.

## 배경

한 저장소에서 에이전트 레인 여러 개를 함께 운영하면 같은 종류의 사고가 반복된다. 무거운 시험을 동시에 돌려 시간 초과가 실패로 보고되고, 레인이 다른 레인의 브랜치나 기본 브랜치에 커밋하고, 패턴으로 프로세스를 종료하다 다른 작업의 서버까지 내린다. 이런 규칙을 지침 문서로만 두면 지켜지지 않는 경우가 생기므로, wb 는 규칙을 설정값으로 두고 훅으로 확인한다.

코드 탐색 도구 사용 기록을 분석한 결과도 설계에 반영했다. 색인 기반 탐색을 먼저 쓴 경우와 텍스트 검색만 쓴 경우의 정답률은 같았다. 색인 도구 호출의 약 3분의 1이 오류였고, 대부분은 작업 폴더가 색인되지 않은 경우였다. 텍스트 검색을 막은 실행은 비용이 3배 이상 늘었다. 그래서 wb 는 텍스트 검색을 막지 않고, 색인이 없는 경로를 먼저 색인 대기열에 넣는다.

## 설치

```
claude plugin marketplace add <저장소 주소>
claude plugin install wb@wb-plugin
```

설치한 뒤 프로젝트 폴더에서 `/wb:init` 을 실행한다. 네 가지를 묻는다.

1. 프로젝트 종류(`web-ui` · `service` · `library` · `other`)
2. 메시지 언어(`ko` · `en`)
3. 전체 검증 명령(없으면 비워 둔다)
4. Claude Code 가 만드는 워크트리까지 wb 가 관리할지(기본 아니요, 아래 「Claude Code 워크트리 훅(선택)」)

답에 따라 `.wb/config.json` 과 `~/.wb/personal.json` 을 만들고, 지시서 폴더 `.wb/briefs/` 를 git 추적 대상에서 뺀다. 이미 있는 파일은 덮어쓰지 않는다.

## 설정

설정은 네 층으로 나뉜다.

| 층 | 파일 | git 추적 | 담는 것 |
|---|---|---|---|
| 기본값 | 플러그인 `defaults/*.json` | 플러그인 저장소 | 모든 키의 기본값 |
| 프로젝트 | `<저장소>/.wb/config.json` | 커밋 | 프로젝트 종류, 브랜치 규칙, 저장 위치, 검증 명령, 문체 지도 |
| 머신 | `~/.wb/machine.json` | 안 함 | 레인 수, 실행 슬롯, 부하 문턱, 보호 포트, 레인 포트 대역 |
| 개인 | `~/.wb/routing.json`, `~/.wb/personal.json` | 안 함 | 모델 라우팅과 금지 모델, 언어, 보고 분량, 무인 재개 |

플러그인 설정 화면(`/config`)에서 고른 언어와 보고 분량은 머신 층과 개인 파일 사이에 들어간다. 이 값은 훅 실행 환경에서만 읽힌다.

값을 합치는 규칙은 키 종류마다 다르다.

| 키 종류 | 규칙 | 해당 키 |
|---|---|---|
| 일반 값 | 높은 층이 덮어쓴다. 개인 > 플러그인 설정 > 머신 > 프로젝트 > 기본값 | 아래 두 줄을 뺀 모든 키 |
| 보호 목록 | 모든 층의 합집합. 어느 층도 다른 층이 넣은 항목을 지울 수 없다 | `routing.denied`, `machine.ports.protected`, `project.git.protected_branches`, `project.protected_paths` |
| 상한 | 기본값을 뺀 층 중 가장 작은 값. 다른 층에 값이 없을 때만 기본값을 쓴다 | `machine.lanes.max`, `machine.slots.heavy.count`, `machine.slots.browser.count`, `machine.load.max` |

상한 규칙에서 기본값을 빼는 이유는 개인 머신 파일이 기본값(레인 3개)보다 큰 값을 쓸 수 있게 하기 위해서다. 프로젝트는 그 값을 더 낮출 수만 있다.

값이 어디서 왔는지는 다음 명령으로 확인한다.

```
wb-config explain machine.lanes.max
wb-config validate
wb-config doctor
```

`explain` 은 합치는 규칙, 적용된 층, 값을 둔 모든 층을 보여 준다. `validate` 는 파일마다 형식을 검사하고 오류가 있으면 파일 이름과 키를 알려 준다. 모르는 키는 무시하고 경고로만 알린다.

예시 파일은 `examples/` 에 있다.

## 모델 라우팅

`routing.json` 은 작업 종류마다 모델 사슬과 바닥선을 둔다. 사슬에서 금지 모델과 사용 한도에 걸린 모델을 빼고, 남은 첫 모델이 바닥선 이상이면 그 모델을 쓴다. 바닥선 아래만 남으면 작업을 보내지 않고 알린 뒤 기다린다. 플러그인 기본값에는 금지 모델이 없다. 특정 모델을 쓰지 않으려면 개인 `routing.json` 의 `denied` 에 넣는다.

`differ_from: implementer` 인 작업(적대적 리뷰)은 구현 모델을 사슬에서 뺀다. 바닥선 이상의 다른 모델이 없으면 같은 모델의 새 문맥으로 진행하고, 레인 보고서에 그 사실을 적게 한다.

`wb-route` 로 결과를 미리 볼 수 있다.

```
wb-route tasks                                  작업 종류별 사슬과 바닥선
wb-route resolve review                         쓸 모델(agent_param). 대기면 종료 코드 3
wb-route explain adversarial --implementer opus 단계별 판정 과정
wb-route check review --model sonnet            모델 선택 판정(차단이면 종료 코드 1)
```

### 디스패치 검사와 지시서

서브에이전트를 보낼 때(Agent 도구) 훅이 다음을 검사한다.

| 조건 | 결과 |
|---|---|
| 지시서 표지 없음, 필수 절·문구 누락, 채우지 않은 `{{…}}` | 차단(`project.dispatch.brief` 가 `warn` 이면 안내만) |
| `model` 미지정 | 차단, 라우팅 결과를 안내 |
| 금지 모델, 한도 소진 모델 | 차단, 사슬의 다음 모델을 안내 |
| 지시서 표지의 작업 종류보다 낮은 모델, 사슬에 없는 모델 | 차단 |
| 사슬 안이지만 첫 선택과 다른 모델 | 안내 |
| 바닥선 이상 모델이 모두 소진 | 차단, 알림, 리셋 시각까지 대기, `/model` 안내 |
| 새 레인인데 레인 수가 `machine.lanes.max` 에 도달 | 차단 |

지시서 첫 줄 표지는 `<!-- wb-brief v1 type=<작업 종류> lane=<레인> template=<템플릿> -->` 형식이다. 필수 절은 목표·범위·금지·시험 규칙·보고 위치·커밋 규칙이고, 헤드리스 브라우저, 전체 시험 스위트 금지, 워크트리 기준 커밋 해시가 본문에 있어야 한다. 템플릿 7종(구현·수리·시안·조사·검수·문서·시험)은 `templates/briefs/ko`, `templates/briefs/en` 에 있다. `wb-check brief <파일>` 로 미리 점검한다. 지시서가 공통 지시서 파일을 가리키면 그 파일까지 함께 읽어 판정한다.

`project.dispatch.exempt_agents` 에 적은 에이전트(기본: `fork`, `claude-code-guide`, `statusline-setup`)는 지시서 검사를 건너뛴다. 금지 모델 검사는 그대로 적용한다.

## 안전 훅

`PreToolUse` 훅이 Bash·Write·Edit·MultiEdit·NotebookEdit·Skill 호출을 실행 전에 판정한다. 결과는 허용, 확인 요청, 차단 셋 중 하나다. 차단 메시지는 막은 이유, 고치는 법, 물어볼 곳 세 줄로 나온다.

**행위자 구분.** 훅 입력에 `agent_id` 가 있으면 서브에이전트, 즉 레인으로 본다. 입력에 없어도 대상 워크트리가 레인 대장(`<git-common-dir>/wb/lanes.json`)에 등록돼 있으면 레인이다. 그 밖은 메인 세션이다.

**git 판정.**

| 동작 | 레인 · 자기 브랜치 | 레인 · 그 밖 | 메인 · 통합·기능 브랜치 | 메인 · 보호 브랜치 |
|---|---|---|---|---|
| commit · cherry-pick · revert · am | 허용 | 차단 | 허용 | 차단. `commit-main` 허가가 있으면 1회 |
| merge · rebase · pull | 통합 브랜치를 받는 것만 허용 | 차단 | 허용(게이트 잠금 중 차단) | 차단. `merge-main` 허가와 게이트 표식. 자기 upstream 동기화는 허용 |
| push | 차단 | 차단 | `git.feature_push` 값(ask·allow·deny) | 차단. `push-main` 허가와 게이트 표식 |
| 강제 push · `--all` · `--mirror` | 차단 | 차단 | 차단 | 차단 |
| `gh pr merge` | 차단 | 차단 | 대상이 보호 브랜치면 `merge-main` 허가 필요 | 같음 |
| 다른 브랜치로 checkout · switch | 차단 | 차단 | 허용 | 허용 |
| 이름 없는 stash · `reset --hard` · `clean -f` · `branch -D` | 확인 요청 | 확인 요청 | 확인 요청 | 확인 요청 |
| 보호 브랜치 삭제·강제 이동 | 차단 | 차단 | 차단 | 차단 |

명령은 `;` `&&` `||` `|` 와 서브셸, `$( )`, `sh -c`, `eval`, heredoc, `env`·`sudo`·`timeout`·`xargs` 같은 감싸기, 셸 별칭과 git 별칭, `git -C`·`cd`·`GIT_DIR` 를 풀어서 판정한다. 명령 이름이나 대상 폴더가 변수라 실행 전에 알 수 없으면 차단한다.

**소유자 허가.** 보호 브랜치 반영은 저장소 소유자가 프롬프트에 `/wb:approve merge-main`(또는 `push-main`, `commit-main`)을 직접 입력할 때만 허가된다. 허가는 15분(`git.owner_grant_ttl_min`) 동안 한 번, 입력 시점의 커밋에만 유효하다. 프로젝트에 게이트 명령(`gate.command`)이 있으면 같은 커밋의 게이트 통과 표식도 있어야 한다. 허가는 `UserPromptExpansion` 훅이 만든다. 이 이벤트는 사람이 슬래시 명령을 입력할 때만 발생하므로 서브에이전트 보고나 다른 세션의 메시지로는 허가가 생기지 않는다. 모델은 이 스킬을 부를 수 없고 허가 파일을 쓸 수도 없다.

**그 밖의 차단.**
- 프로세스 종료: `pkill`·`killall`·`kill $(pgrep …)` 처럼 이름으로 끄는 명령은 차단한다. `kill <PID>`·`lsof -ti :포트 | xargs kill`·`fuser -k` 는 대상이 보호 포트(`machine.ports.protected`)를 쓰면 차단한다.
- 삭제: `/`·홈·시스템 폴더·프로젝트 루트·`.git` 를 지우는 `rm -r` 는 차단한다. 프로젝트 밖은 확인 요청, 프로젝트 안과 임시 폴더는 허용한다.
- 브라우저: 헤드리스가 아닌 Chrome 실행, `--headed`, `PWDEBUG`, `playwright codegen`·`--ui`, 브라우저로 여는 `open` 은 차단한다.
- 경로: `project.protected_paths` 에 쓰는 것은 차단한다. wb 상태 파일(허가·게이트 표식·레인 대장) 쓰기도 차단한다. wb 설정 파일 수정은 확인 요청이다.

**실패 시 차단.** 설정에 오류가 있으면 git 반영·프로세스 종료·삭제·브라우저 실행을 차단하고 설정 오류 위치를 알려 준다. 훅 내부 오류도 차단으로 처리한다.

**보호 목록은 줄일 수 없다.** `protected_branches`·`protected_paths`·`ports.protected`·`denied` 는 모든 층의 합집합이다. 어느 층도 다른 층이 넣은 항목을 지우지 못한다.

## 세션 보조 훅

| 기능 | 동작 | 설정 키 | 관리 |
|---|---|---|---|
| 핸드오프 | 새 세션과 `/clear` 때 `progress.md` 의 최신 섹션을 넣는다. 마지막 갱신 뒤에 커밋이나 파일 변경이 있으면 턴 종료를 한 번 막아 갱신을 요구한다. 같은 세션은 20분 동안 다시 막지 않는다 | `personal.handoff.{enabled, file, throttle_min}` | |
| 자동 재개 | 사용량 한도로 턴이 끝나면 리셋 시각 2분 뒤에 같은 세션을 헤드리스로 재개한다. 예약은 macOS 는 launchd, Linux 는 systemd 사용자 타이머, 그 밖에는 백그라운드 대기 프로세스로 한다. 한도에 걸린 모델은 `limits.json` 에 기록한다 | `personal.auto_retry.{enabled, permission_mode, bypass_ack}`, `routing.limits_state` | `wb-retry`, `/wb:auto-retry` |
| 토큰 가드 | 최근 구간(기본 5시간)의 로컬 토큰 사용량을 예산에 대한 비율로 환산하고, 단계가 오를 때만 지침을 넣는다. 90%는 작업 단위 축소, 95%는 웨이브마다 핸드오프, 99%는 마지막 핸드오프와 알림 후 대기다 | `personal.token_guard.{enabled, stages, budget, window_hours}` | `wb-token`, `/wb:token-guard` |
| 간결 모드 | 켠 저장소에서 세션 시작 때 출력·도구 호출을 줄이는 규칙을 넣는다 | `personal.terse`, 저장소 스위치 | `wb-terse`, `/wb:terse` |
| 체크포인트 | 한도, 서브에이전트 종료, 컨텍스트 압축 시점에 레인 브랜치에서 추적 중인 파일의 변경만 `wip(wb)` 커밋으로 남긴다. 추적 안 된 새 파일과 비밀 파일 패턴(`.env*`, `*.pem`, `*.key`, `id_*`, `*credentials*`, `*.p12`)은 커밋하지 않고 `.git/wb/checkpoint.json` 과 알림으로 알린다. 프로젝트 훅(pre-commit)이 실패하면 체크포인트를 건너뛰고 사유를 기록한다. 보호 브랜치와 레인이 아닌 브랜치는 건드리지 않고 push 하지 않는다 | `personal.checkpoint.enabled` | |

자동 재개의 권한 모드 기본값은 `default` 다. 이 모드에서는 승인이 필요한 도구가 무인 실행에서 거절되므로, 재개한 작업이 그 지점에서 멈출 수 있다. `bypassPermissions` 는 `wb-retry mode bypassPermissions --i-understand` 로 위험을 확인한 뒤에만 켜지고, 확인 기록(`bypass_ack`)이 없으면 `default` 로 재개한다.

토큰 가드의 예산은 기본이 0(미보정)이며 이 상태에서는 동작하지 않는다. 앱에서 한도에 도달했을 때 `wb-token calibrate` 를 실행하면 그 시점의 사용량이 예산으로 기록된다. 집계 대상은 이 기기의 Claude Code 사용뿐이고 비율은 추정치다.

## 실행 슬롯·포트·레인 워크트리

**실행 슬롯.** 전체 시험·빌드·설치·e2e·색인처럼 무거운 실행과 헤드리스 브라우저는 머신 전체에서 개수를 센다. 기본값은 무거운 실행 2개, 브라우저 2개다. 레인 수(`machine.lanes.max`, 기본 3)와는 따로 센다.

```
wb-slot --kind heavy -- pnpm -r test
wb-slot --kind heavy,browser -- npx playwright test
wb-slot status        # 사용 중인 슬롯과 1분 부하
wb-slot reap          # 끝난 임대 회수
```

- 빈 슬롯이 없거나 1분 부하가 `machine.load.max`(기본 논리 코어 × 2) 이상이면 기다린다. `--timeout <초>` 를 주면 그 시간 뒤에 실행하지 않고 끝낸다(종료 코드 75).
- 임대는 실행 중 주기적으로 갱신한다. 소유 프로세스가 없어졌거나 `machine.slots.stale_after_min`(기본 90분) 동안 갱신이 없으면 다음 호출이 회수한다.
- e2e 처럼 두 종류가 필요한 실행은 두 슬롯을 함께 잡는다. 하나만 잡히면 놓고 다시 기다린다.
- 슬롯 안에서 실행된 명령은 `WB_SLOT_HELD` 를 받는다. 그 안에서 같은 종류의 `wb-slot` 을 다시 불러도 기다리지 않는다.

무거운 명령은 `defaults/heavy-patterns.json` 의 패턴 묶음으로 판정한다. `machine.slots.heavy.patterns`·`machine.slots.browser.patterns` 가 묶음 이름을 고르고, 프로젝트는 `.wb/config.json` 의 `slots.heavy`·`slots.browser` 에 정규식을 더할 수 있다. 파일 하나만 돌리는 시험(`vitest run a.test.ts`)은 대상이 아니다. Bash 도구가 이런 명령을 슬롯 없이 실행하면 `machine.slots.guard` 에 따라 다음과 같이 처리한다.

| 값 | 동작 |
|---|---|
| `warn`(기본) | 실행은 그대로 두고, `wb-slot` 으로 감싼 명령을 Claude 에게 알려 준다 |
| `deny` | 실행을 막고 감싼 명령을 안내한다 |

**포트.** 보호 포트(`machine.ports.protected`)와 레인 포트 대역(`machine.ports.lane_range`) 숫자는 머신 설정에만 둔다. 문서와 지시서는 이름만 쓰고 `wb-port get <이름> [--lane <id>]` 로 값을 얻는다. 레인은 대역 하나(`per_lane` 이름별 포트)를 임대한다. 기본 대역은 41000 부터 레인마다 20칸씩이다(macOS AirPlay 가 쓰는 7000 대를 피한다). 보호 포트가 들어 있는 대역, 이미 다른 프로세스가 쓰는 포트가 있는 대역, 다른 레인이 임대한 대역은 건너뛴다. 임대 대장은 `<git-common-dir>/wb/ports.json` 이다.

**레인 워크트리.**

```
wb-worktree create l3            # 통합 브랜치 HEAD 기준, 포트 임대, 레인 대장 등록
wb-worktree list
wb-worktree remove l3 [--force] [--delete-branch]
```

- 기준은 통합 브랜치 HEAD 다. 통합 브랜치는 `--integration`, 레인 대장의 `integration`, `project.git.integration_branch_pattern` 에 맞는 유일한 로컬 브랜치 순서로 정한다. 없으면 현재 HEAD 를 쓴다.
- 브랜치 이름은 통합 브랜치의 마지막 부분을 레인 이름으로 바꾼 것이다(`wb/mvp/int` → `wb/mvp/l3`). 경로는 `project.git.worktree_root`(기본 `{repo}/../wt-{task}`)다.
- `.worktreeinclude` 에 적힌 git 무시 파일(예: `.env`)을 복사한다.
- `project.worktree.setup` 에 설치 명령(예: `pnpm install --frozen-lockfile`)을 적으면 새 워크트리에서 무거운 실행 슬롯 안에서 실행한다. 명령은 `WB_LANE`, `WB_PORT_<이름>` 환경변수를 받는다.
- 살아 있는 레인이 `machine.lanes.max` 에 닿으면 만들지 않는다.
- 지울 때 그 경로 안에서 도는 프로세스가 있으면 지우지 않고 PID 목록을 보여 준다. 하나씩 `kill <PID>` 로 끈 뒤 다시 실행한다. 커밋하지 않은 변경이 있으면 `--force` 가 필요하다. 주 체크아웃과 워크트리가 아닌 폴더는 지우지 않는다. `--delete-branch` 는 브랜치의 커밋이 다른 로컬 브랜치에도 있을 때만 지운다.

**Claude Code 워크트리 훅(선택).** WorktreeCreate 훅은 등록되는 순간 Claude Code 의 워크트리 생성(`claude --worktree`, `EnterWorktree`, 서브에이전트 `isolation: "worktree"`, 백그라운드 세션)을 통째로 대체한다. 등록된 훅이 기본 동작으로 넘기는 방법은 없다. 그래서 wb 는 이 훅을 플러그인 `hooks.json` 에 넣지 않고 기본으로 꺼 둔다. `/wb:init` 의 「레인 워크트리를 wb 가 관리할까요?」에 예라고 답하거나 `.wb/config.json` 에 `"worktree": { "hook": true }` 를 두면, 주 체크아웃의 `.claude/settings.local.json`(이 머신 전용, git 제외)에 WorktreeCreate·WorktreeRemove 훅을 등록한다. 플러그인을 갱신하면 설치 경로가 바뀌므로, 세션 시작 훅이 매번 등록 경로를 현재 플러그인으로 맞추고 설정을 끄면 등록을 지운다. 다른 도구의 WorktreeCreate 훅이 이미 있으면 등록하지 않고 알린다. 상태는 `wb-worktree hooks status`, 즉시 반영은 `wb-worktree hooks sync` 로 한다.

켜면 wb 의 훅은 Claude Code 와 같은 위치(`.claude/worktrees/<이름>`)와 브랜치 이름(`worktree-<이름>`)을 쓰고, 통합 브랜치가 하나로 정해지면 그 HEAD 를 기준으로 삼는다. 포트 임대·`.worktreeinclude` 복사·설치 명령도 같이 처리한다. 이 워크트리는 레인 대장에 등록하지 않는다. 설치 명령은 슬롯을 2분 안에 얻지 못하면 건너뛰고, 나중에 `wb-worktree setup <이름>` 으로 실행한다. 원격 기본 브랜치 기준 생성, 필터 드라이버 차단, 오래된 워크트리 자동 정리 같은 Claude Code 기본 동작은 이 경우 적용되지 않는다.

**정리.** `wb-reap` 은 끝난 슬롯 임대를 회수하고, 폴더가 없어진 레인의 포트 임대와 대장 항목을 보여 준다(`--apply` 로 정리). 오래된 `gate.lock` 은 알리기만 하고 `--gate-lock` 을 줄 때만 지운다. 프로세스는 끄지 않는다.

## 레인 원장·진행판·재개

웨이브와 레인의 진행 상태는 `<git 공용 폴더>/wb/` 아래에 기록한다. 모든 워크트리가 같은 파일을 본다. 기록은 `wb-waves` 로만 한다.

| 파일 | 내용 |
|---|---|
| `waves.json` | 웨이브별 레인 상태(대기·진행·검수 대기·막힘·실패·완료), 모델, 작업 종류, 지시서 경로, 실행·되돌림 횟수, 할 일, 검증 결과, 토큰 합계, 이력 |
| `dispatch.json` | 디스패치 검사를 통과한 호출(대기)과 실행 중인 에이전트 |
| `metrics/lanes.jsonl` | 시작·종료·상태 변경·되돌림 사건을 한 줄씩. 작업 종류, 라우팅 모델, 실제 모델, 분류 근거, 지시서 파일 해시, 토큰 |
| `lanes.json` | 레인 워크트리 대장(L4). 에이전트가 시작하면 `agent_id` 를 적는다 |

**기록 흐름.** 디스패치 검사 훅이 통과시킨 호출을 `dispatch.json` 에 남긴다. SubagentStart 훅이 같은 종류의 가장 오래된 대기 호출과 에이전트를 짝지어 레인을 진행 상태로 바꾸고 실행 횟수를 센다. SubagentStop 훅이 트랜스크립트의 사용량을 합산해 레인을 검수 대기로 바꾼다. 검수 대기 레인에 새 에이전트가 시작되면 되돌림 1회로 센다. 지시서 표지에 `lane=` 이 없으면 레인에 묶지 않고 metrics 에만 남긴다. 짝지은 대기 호출은 10분이 지나면 버린다.

**명령.**

```
wb-waves init-wave <웨이브> [--title 제목] [--base-ref 기준]
wb-waves lane <웨이브> <레인> [--task 종류] [--model 모델] [--brief 파일] [--todo 항목]...
wb-waves status|todo|verify|note|return <웨이브> <레인> …
wb-waves board [--json]        웨이브·레인 상태표
wb-waves metrics [--lane 레인]  레인별 실행·토큰·모델
wb-waves statusline            한 줄 상태(플러그인 settings.json 의 subagentStatusLine)
wb-waves resume [--stale-min N] [--prompt 웨이브/레인]
```

`/wb:lanes` 가 진행판을 보여 주고, `/wb:pickup` 과 `/wb:resume` 이 세션 시작·재개 보고를 만든다. 재개 보고는 `progress.md` 최신 절, `git status`, 워크트리 목록, 최근 커밋 5건, 레인 판정을 보여 주고 오래된 항목을 먼저 알린다. 오래된 항목은 `progress.md` 가 작업보다 낡음, 활동이 `project.waves.stale_min`(기본 20분) 넘게 없는 진행 레인, 사라진 워크트리, 레인 대장에 없는 워크트리, 워크트리의 미커밋 변경, 시작으로 이어지지 않은 디스패치, 종료 기록 없는 에이전트다. 워크트리와 브랜치는 이 단계에서 지우지 않는다.

**번호 예약.** 마이그레이션·결정 문서처럼 번호가 붙는 파일을 레인이 동시에 만들 때 번호를 `wb-number` 로 받는다. 계열은 `.wb/config.json` 에 선언한다.

```json
"numbers": { "migration": { "dir": "db/migrations", "pattern": "^(\\d+)_", "width": 3, "start": 1 } }
```

`wb-number reserve migration --lane l3` 은 폴더의 파일(작업 트리와 주 체크아웃 양쪽)과 살아 있는 예약보다 큰 번호를 돌려준다. `release` 로 예약을 풀고, `check` 는 같은 번호의 파일 중복과 이중 예약을 찾는다(종료 코드 1). 예약 대장은 `numbers.json` 이다.

**시험 케이스 원장.** `paths.e2e_ledger`(기본 `docs/e2e/`)에 `<모듈>.cases.json` 과 `defect-register.json` 을 둔다. `wb-cases init|add|retire|set|list|check` 와 `wb-defects add|resolve|list|check` 로 관리한다. 케이스 ID 는 다시 쓰지 않는다(폐기한 ID 는 `retired_ids` 에 남는다). 보류(`fixme`) 케이스는 열린 결함을 가리켜야 하고, 결함이 종료되면 `check` 가 보류 해제를 요구한다. 결함은 삭제하지 않는다.

## 시험 결과 엑셀

통합·최종 검증의 결과를 엑셀(xlsx)과 요약 json 으로 남긴다. 생성기는 Python 3.8 이상과 openpyxl 이 필요하다(`python3 -m pip install openpyxl`). 없으면 `wb-test-report` 가 설치 명령을 안내하고 엑셀 생성만 건너뛴다(종료 코드 0, `--require` 를 주면 3). 확인은 `wb-test-report env` 로 한다.

| 위치 | 내용 |
|---|---|
| `templates/test-results/core/` | 결과 모델, 어댑터(vitest · jest · Playwright · pytest), 원장 대조, 시트 구성. 결과 파일만 읽으며 프로젝트 이름·경로를 모른다 |
| `templates/test-results/project/` | `verify-all.mjs`(gate → 단계별 시험 → 엑셀, 실패해도 계속), `run-gate.mjs`(gate 를 단계로 나눠 기록), `verify.config.json`(스택별 단계 목록) |

```
wb-test-report init                  .wb/verify.config.json 생성(gate 와 stages 를 프로젝트에 맞게 고친다)
wb-test-report run [--name N] [--only a,b] [--skip a,b] [--ledger-priority P0] [--no-slot]
wb-test-report build --input vitest:unit:app=out.json[,log=out.log] [--gate-json gate.json] [--rerun playwright=again.json]
wb-test-report latest | summary [--json]
wb-check test-results [--json] [--require-pass]
```

단계(`stages`)마다 `adapter`(vitest · jest · playwright · pytest), `kind`(unit · integration · e2e · uistab), `cmd`(`{file}` 에 구조화 결과가 놓인다), `slot`(`heavy` · `heavy,browser` · `none`)을 적는다. 무거운 단계는 `wb-slot` 안에서 돈다. 로그만 남은 실행은 `build --input adapter:kind:이름=log=<로그>` 로 읽는다.

시트는 요약 · 단위 · 통합 DB · e2e · e2e 상세 · UI 안정성 · gate 단계 · 실패 목록 · 간헐 실패 · 원장 대조 · 커버리지 · 변이이고, 결과가 없는 시트는 만들지 않는다(요약·실패 목록·간헐 실패는 항상). 같은 실행 안의 재시도에서 통과하거나 별도 재실행(`--rerun`)에서 통과한 시험은 간헐로 센다. 원장 대조는 `paths.e2e_ledger` 의 `*.cases.json` 과 시험 제목의 케이스 ID(`PAY-001`, 이어 쓴 `PAY-002 · 003` 포함)를 맞춰, 활성 케이스의 실패·간헐·건너뜀·미실행(`--ledger-priority`), 보류(`fixme`) 케이스의 통과, 원장에 없거나 폐기된 ID 를 불일치로 적는다. 원장이 있으면 불일치 0 이 출하 조건이다.

저장 위치는 `paths.test_results`(기본 `docs/test-results/<날짜>/<이름>-<HHMM>.xlsx`, 같은 이름의 `.json` 이 함께 생긴다)이고 커밋한다. 원본 로그는 `paths.test_runs_raw` 에 두며 커밋하지 않는다. `test-results/` 같은 넓은 `.gitignore` 패턴이 `docs/test-results/` 를 가리면 `/wb:init` 이 예외 줄을 제안하고, `wb-check test-results` 는 커밋되지 않은 파일로 보고한다. `/wb:report` 는 `wb-check test-results --json` 의 `file`·`json` 을 증거로 붙이고 `wb-test-report summary --json` 의 수치를 그대로 인용한다.

## 보안과 한계

- 훅과 도구는 외부로 아무것도 보내지 않는다. 예외로 안전 훅은 `gh pr merge` 앞에서 PR 대상 브랜치를 알기 위해 `gh pr view` 를 실행한다.
- 오너 허가 파일은 같은 머신의 다른 프로세스가 직접 쓰는 경우까지 막지는 못한다. 실수를 줄이기 위한 장치다.
- 안전 훅은 명령 문자열을 판정한다. 스크립트 파일 안의 명령, 다른 언어(python·node)로 실행하는 git·kill 호출, Bash 로 설정 파일을 고치는 경우는 판정 범위 밖이다.
- `gh pr view` 로 대상 브랜치를 확인하지 못하면 `gh pr merge` 는 차단한다.

## 개발

```
npm test          # node:test 단위 시험
npm run validate  # claude plugin validate --strict
```

## 라이선스

MIT
