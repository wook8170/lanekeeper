# wb — 에이전트 작업대

[English](README.en.md)

사용 설명서: [docs/README.md](docs/README.md) — 설치와 처음 30분, 기능별 사용법, 설정 키 전체, 규칙 안내, 문제 해결.

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
| 개인 | `~/.wb/routing.json`, `~/.wb/personal.json` | 안 함 | 모델 라우팅과 금지 모델, 언어, 보고 분량, 무인 재개, 큰 설계에 쓸 별도 플러그인 이름(`design_plugin`) |

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
| 핸드오프 | `progress.md` 는 지금 유효한 상태만 담는다(기본 300줄 이하). 새 세션과 `/clear` 때 파일 전체와 아카이브 검색 방법을 넣는다. 마지막 갱신 뒤에 커밋이나 파일 변경이 있으면 턴 종료를 한 번 막고, 끝난 내용은 `docs/progress-archive/progress-<YYYY-MM>.md` 에 덧붙이고 `progress.md` 를 통째로 다시 쓰라고 요구한다. 같은 세션은 20분 동안 다시 막지 않는다. 기준 줄 수를 넘으면 세션 시작·종료·재개 보고에서 알리고, 누적형 파일은 `wb-waves handoff migrate` 로 옮기게 안내한다 | `personal.handoff.{enabled, file, throttle_min, max_lines, archive_dir}` | `wb-waves handoff` |
| 자동 재개 | 사용량 한도로 턴이 끝나면 리셋 시각 2분 뒤에 같은 세션을 헤드리스로 재개한다. 예약은 macOS 는 launchd, Linux 는 systemd 사용자 타이머, 그 밖에는 백그라운드 대기 프로세스로 한다. 한도에 걸린 모델은 `limits.json` 에 기록한다 | `personal.auto_retry.{enabled, permission_mode, bypass_ack}`, `routing.limits_state` | `wb-retry`, `/wb:auto-retry` |
| 토큰 가드 | Claude Code 가 남기는 공식 5시간·7일 사용량에 그 뒤 로컬 사용 추정을 더해 판정하고, 단계가 오를 때만 지침을 넣는다. 90%는 작업 단위 축소, 95%는 웨이브마다 핸드오프, 99%는 마지막 핸드오프와 알림 후 대기다 | `personal.token_guard.{enabled, stages, budget, window_hours, fresh_min, source}` | `wb-token`, `/wb:token-guard` |
| 간결 모드 | 켠 저장소에서 세션 시작 때 출력·도구 호출을 줄이는 규칙을 넣는다 | `personal.terse`, 저장소 스위치 | `wb-terse`, `/wb:terse` |
| 체크포인트 | 한도, 서브에이전트 종료, 컨텍스트 압축 시점에 레인 브랜치에서 추적 중인 파일의 변경만 `wip(wb)` 커밋으로 남긴다. 추적 안 된 새 파일과 비밀 파일 패턴(`.env*`, `*.pem`, `*.key`, `id_*`, `*credentials*`, `*.p12`)은 커밋하지 않고 `.git/wb/checkpoint.json` 과 알림으로 알린다. 프로젝트 훅(pre-commit)이 실패하면 체크포인트를 건너뛰고 사유를 기록한다. 보호 브랜치와 레인이 아닌 브랜치는 건드리지 않고 push 하지 않는다 | `personal.checkpoint.enabled` | |

자동 재개의 권한 모드 기본값은 `default` 다. 이 모드에서는 승인이 필요한 도구가 무인 실행에서 거절되므로, 재개한 작업이 그 지점에서 멈출 수 있다. `bypassPermissions` 는 `wb-retry mode bypassPermissions --i-understand` 로 위험을 확인한 뒤에만 켜지고, 확인 기록(`bypass_ack`)이 없으면 `default` 로 재개한다.

토큰 가드는 `~/.claude.json` 에 저장된 공식 사용량을 먼저 쓰고, 조회한 지 10분이 지나면 그 뒤의 로컬 사용량을 계정별 보정 계수로 환산해 더한다. 보정은 자동이며, 앱에서 본 값은 `wb-token calibrate --five <n> --seven <n>` 으로 넣을 수 있다. 공식 값이 없으면 예산(`personal.token_guard.budget`, 기본 0) 방식으로 동작하고, 예산도 보정도 없으면 동작하지 않는다.

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
wb-waves handoff check [--json]             progress.md 줄 수와 아카이브 파일 목록(기준 초과 시 종료 코드 1)
wb-waves handoff archive "<요지>" [--from 파일]  파일(기본: progress.md 전체)을 이번 달 아카이브 끝에 날짜 절로 덧붙임
wb-waves handoff migrate [--force]          기준을 넘은 progress.md 를 아카이브로 옮기고 새 현재 상태 파일을 만듦
```

`/wb:lanes` 가 진행판을 보여 주고, `/wb:pickup` 과 `/wb:resume` 이 세션 시작·재개 보고를 만든다. 재개 보고는 `progress.md` 전체(기준 줄 수를 넘은 누적형 파일은 최신 절만)와 아카이브 위치, `git status`, 워크트리 목록, 최근 커밋 5건, 레인 판정을 보여 주고 오래된 항목을 먼저 알린다. 오래된 항목은 `progress.md` 가 작업보다 낡음, `progress.md` 가 기준 줄 수(`personal.handoff.max_lines`, 기본 300)를 넘음, 활동이 `project.waves.stale_min`(기본 20분) 넘게 없는 진행 레인, 사라진 워크트리, 레인 대장에 없는 워크트리, 워크트리의 미커밋 변경, 시작으로 이어지지 않은 디스패치, 종료 기록 없는 에이전트다. 워크트리와 브랜치는 이 단계에서 지우지 않는다.

**progress.md 와 아카이브.** `progress.md` 는 지금 유효한 상태만 담는다. 맨 위에 아카이브 위치와 검색 방법 한 줄을 두고, 목표와 오너 결정 · 브랜치와 서버 · 진행 중(표) · 다음 할 일 · 확인 대기 · 시스템 지식 · 재개 명령 절을 쓴다. 매 웨이브마다 통째로 다시 쓴다. 끝난 내용(완료한 웨이브, 해소된 확인 대기, 더는 맞지 않는 상태)은 `docs/progress-archive/progress-<YYYY-MM>.md` 끝에 `## <YYYY-MM-DD HH:MM> — <요지>` 절로 덧붙인다. 끝난 것과 남은 것을 가려내기 어려우면 `wb-waves handoff archive "<요지>"` 로 지금 파일 전체를 덧붙인 뒤 새로 쓴다. 덧붙인 내용의 제목은 날짜 절 아래로 한 단계씩 내린다. 이미 누적형으로 커진 파일은 `wb-waves handoff migrate` 가 통째로 `docs/progress-archive/progress-until-<YYYY-MM-DD>.md` 로 옮기고(추적 중이면 `git mv`) 위 절을 갖춘 새 파일을 만든다. 이력은 지우지 않으며, 필요한 부분은 `grep -n '<키워드>' docs/progress-archive/*.md` 로 찾는다. 폴더는 `personal.handoff.archive_dir` 로 바꿀 수 있다.

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
wb-test-report gate-pass             project.gate.command 실행, 통과하면 게이트 통과 표식
wb-test-report latest | summary [--json]
wb-check test-results [--json] [--require-pass]
```

`wb-test-report run`·`gate` 는 실행하는 동안 `<git 공용 폴더>/wb/gate.lock` 을 잡아 둔다. 그동안 병합은 기다리고, 다른 게이트 실행은 종료 코드 3 으로 멈춘다. 실행이 끝나면 잠금을 지운다. `run`(일부만 고르는 `--only`·`--skip` 없이)이나 `gate-pass` 가 통과하고 커밋하지 않은 변경이 없으면 `<git 공용 폴더>/wb/<git.gate_stamp>.json` 에 게이트 통과 표식(커밋 HEAD·시각·명령)을 남긴다. 보호 브랜치 반영 판정은 이 표식을 읽고, 표식 뒤에 결과 폴더(`paths.test_results`) 안의 파일만 바뀐 커밋은 같은 커밋으로 본다. `wb-check test-results` 의 HEAD 비교도 같은 규칙을 따른다.

단계(`stages`)마다 `adapter`(vitest · jest · playwright · pytest), `kind`(unit · integration · e2e · uistab), `cmd`(`{file}` 에 구조화 결과가 놓인다), `slot`(`heavy` · `heavy,browser` · `none`)을 적는다. 무거운 단계는 `wb-slot` 안에서 돈다. 로그만 남은 실행은 `build --input adapter:kind:이름=log=<로그>` 로 읽는다.

시트는 요약 · 단위 · 통합 DB · e2e · e2e 상세 · UI 안정성 · gate 단계 · 실패 목록 · 간헐 실패 · 원장 대조 · 커버리지 · 변이이고, 결과가 없는 시트는 만들지 않는다(요약·실패 목록·간헐 실패는 항상). 같은 실행 안의 재시도에서 통과하거나 별도 재실행(`--rerun`)에서 통과한 시험은 간헐로 센다. 원장 대조는 `paths.e2e_ledger` 의 `*.cases.json` 과 시험 제목의 케이스 ID(`PAY-001`, 이어 쓴 `PAY-002 · 003` 포함)를 맞춰, 활성 케이스의 실패·간헐·건너뜀·미실행(`--ledger-priority`), 보류(`fixme`) 케이스의 통과, 원장에 없거나 폐기된 ID 를 불일치로 적는다. 원장이 있으면 불일치 0 이 출하 조건이다.

저장 위치는 `paths.test_results`(기본 `docs/test-results/<날짜>/<이름>-<HHMM>.xlsx`, 같은 이름의 `.json` 이 함께 생긴다)이고 커밋한다. 원본 로그는 `paths.test_runs_raw` 에 두며 커밋하지 않는다. `test-results/` 같은 넓은 `.gitignore` 패턴이 `docs/test-results/` 를 가리면 `/wb:init` 이 예외 줄을 제안하고, `wb-check test-results` 는 커밋되지 않은 파일로 보고한다. `/wb:report` 는 `wb-check test-results --json` 의 `file`·`json` 을 증거로 붙이고 `wb-test-report summary --json` 의 수치를 그대로 인용한다.

## 검수·취합·보고

레인이 끝나면 메인 세션은 검수(`/wb:review-lane`) → 취합(`/wb:integrate`) → 보고(`/wb:report`) 순서로 진행한다. 판정은 스크립트가 하고, 사람이 정할 것(되돌림을 보낼지, 병합 준비를 마칠지)만 묻는다.

**검수.** `wb-check lane <레인>` 이 9항목을 판정한다. 레인 보고 파일을 정본으로 읽고 반환 메시지와 대조한다.

| # | 항목 | 실패 조건 |
|---|---|---|
| 1 | 보고 HEAD | 없음, 저장소에 없음, 통합 HEAD 를 조상으로 두지 않음 |
| 2 | 보고 파일 | 없음, 새 HEAD·시험·남은 것 중 빠진 항목, 반환 메시지와 HEAD·통과 수가 다름 |
| 3 | 프로젝트 가드 | `review.guards` 명령이 실패(설정 없으면 건너뜀) |
| 4 | 수정 전 실패 기록 | 코드가 바뀌었는데 수정 전 실패 확인이 보고에 없음 |
| 5 | 지시서 범위 | 지시서의 소유 파일 밖이나 금지 파일을 바꿈(목록이 없으면 건너뜀) |
| 6 | 캡처 확인 | UI 변경인데 캡처가 없음, 파일이 없음, 메인이 열어 보지 않음 |
| 7 | 서빙 코드 표식 | 웹 UI 변경인데 서빙 중인 코드에 변경 표식이 없음 |
| 8 | 시험 결과 | 레인: 보고에 통과 수가 없거나 실패가 있음. 통합·최종: 해당 HEAD 의 결과 엑셀이 커밋되지 않음 |
| 9 | 용어 | `wb-check terms` 가 기준선보다 늘었거나 새 용어가 `/wb:decide` 대기 목록에 없음(사전·검사가 없으면 건너뜀) |

UI 변경은 `mockup.ui_globs` 에 맞는 파일이 바뀐 경우다. 이 값이 비어 있으면 `web-ui` 프로젝트의 화면 파일(`.tsx` `.vue` `.css` 등)로 판단한다. 실패 항목이 있으면 `.wb/briefs/<레인>-return-<번호>.md` 에 되돌림 지시서를 만든다. 이 지시서는 디스패치 검사를 통과하는 형식이다. `--wave W --record` 를 주면 원장에 검수 결과를 남기고, 통과면 완료, 실패면 되돌림 1회로 기록한다.

**취합.** `wb-integrate <레인 브랜치>` 는 통합 워크트리에서 시험 병합(`--no-commit --no-ff`)을 하고 충돌을 분류한다.

| 분류 | 처리 |
|---|---|
| 원장(`*.cases.json`, `defect-register.json`) | `id` 기준 합집합, 같은 id 는 통합 쪽 우선, 폐기한 id 는 되살리지 않음 |
| 등록 파일(`hooks/hooks.json`) | 객체 병합, 목록 합집합, 값이 다르면 통합 쪽 |
| 생성물(`*.xlsx`, 잠금 파일) | 통합 쪽을 받은 뒤 `integrate.regenerate` 명령으로 다시 만듦 |
| 코드(그 밖의 모든 파일) | 병합을 중단하고, 레인에 「통합 최신을 병합해 빨리 감기 가능한 HEAD 를 돌려 달라」는 되돌림 지시서를 만듦 |

분류 규칙은 `integrate.rules`(앞에서부터 처음 맞는 규칙)로 바꾼다. 충돌을 푼 뒤 번호 예약 계열의 중복 번호를 확인하고, `integrate.guards` 를 병합된 작업 트리에서 실행한다. 하나라도 실패하면 커밋하지 않고 병합을 되돌린 뒤 되돌림 지시서를 만든다. 게이트가 실행 중이면(`<git 공용 폴더>/wb/gate.lock`) 시작하지 않는다(종료 코드 3). `--dry-run` 은 모든 단계를 거친 뒤 병합을 되돌린다.

**보고.** `/wb:report` 는 시험 결과 엑셀, 결함 대장, 전후 캡처를 묶어 아티팩트로 게시한다.

```
wb-art keep <png>... --slug <주제>     다시 볼 캡처를 paths.artifacts_keep 에 둔다(커밋)
wb-art temp <png>... --slug <주제>     일회성 캡처를 스크래치에 둔다
wb-art report --title T --md body.md --image "전=a.png" --image "후=b.png" [--keep]
                                      이미지를 data URI 로 넣은 HTML 한 파일
wb-art env                            WebP 변환 도구 확인
wb-defects summary [--json] · export [--format md,xlsx]
```

`artifacts_keep_webp.over_kb`(기본 300KB)를 넘는 PNG 는 `quality`(기본 80) WebP 로 바뀐다. 변환 도구는 cwebp, 없으면 Python Pillow 다. 둘 다 없으면 PNG 를 그대로 두고 설치 방법을 알린다. 보고 HTML 은 외부 주소를 쓰지 않으므로 원격 기기에서도 이미지가 보인다. 결함 대장 엑셀은 Python 3 와 openpyxl 이 필요하다. 없으면 Markdown 만 만들고 종료 코드 3 을 돌려준다.

Stop 훅 `artifact-check` 는 `/wb:report` 를 실행한 세션이 아티팩트(Artifact 도구, 또는 `artifact_fallback: html-file` 일 때 `wb-art report`) 없이 끝나려 하면 한 번 막는다. 시험 결과 엑셀을 쓰는 프로젝트(`.wb/verify.config.json` 이나 결과 폴더가 있음)는 최신 결과 엑셀도 확인한다. `personal.report.artifact_check: false` 로 끈다.

## 시안 먼저

PreToolUse 훅 `mockup-first` 는 화면 구조를 바꾸는 쓰기를 결정 기록 전에 막는다. `mockup.ui_globs` 가 비어 있으면(기본) 동작하지 않는다.

- 구조 변경: 새 화면 파일 생성, 마크업 요소 구성이 바뀌는 수정, 스타일 시트의 선택자 추가·삭제. 문구·속성·CSS 속성 값만 바꾸는 수정은 통과한다.
- 결정 기록: `wb-decide new <이름> --kind mockup --scope "src/list/**" …` 로 질문 문서를 만들고, 오너의 선택을 `wb-decide answer` 로 기록한다. 문서 표지 `<!-- wb-decision v1 status=decided kind=mockup scope=src/list/** -->` 의 `scope` 가 그 파일을 덮으면 통과한다. 대기 중(`status=pending`)인 결정은 풀지 않는다. `scope` 를 생략하면 모든 화면 파일을 덮는다. 손으로 쓴 표지에 `status` 가 없으면 결정된 것으로 본다. 문서 골격은 `templates/decision/` 하나다.
- 순서: 현재 화면과 대안 시안을 프로젝트 토큰으로 만들어 아티팩트로 보여 주고(`mockup.tokens_css`), 선택을 받은 뒤 결정 문서를 커밋한다. 레인 워크트리는 이 커밋 뒤의 통합 HEAD 에서 만든다.
- 끄기: `mockup.decision_required: false`.

## 초보자 계층

레인 흐름을 모르는 사용자가 한 줄 요청만으로 작업을 시작하고, 막혔을 때 이유와 해결 방법을 바로 읽을 수 있게 하는 부분이다.

| 명령 | 역할 |
|---|---|
| `/wb:work` | 한 줄 요청을 종류(고장·기능·화면·문서·조사·큰 설계)로 나누고, 단계와 각 단계의 모델을 보여 준 뒤 지시서 작성부터 보고까지 안내한다. `wb-work plan "<요청>"`, `wb-work progress` |
| `/wb:explain` | 지금 막힌 것과 기다리는 것을 쉬운 말로 설명한다. 설정 오류, 사용 한도, 게이트 실행 중, 멈춘 레인, 레인 상한, 가득 찬 실행 자리, 낡은 인계 파일, 남은 워크트리, 보호 브랜치를 확인한다. `wb-explain`, `wb-explain code <메시지 코드>`, `wb-explain links` |
| `/wb:writing-style` | `project.style.map` 으로 파일별 문체(해요체·보고서체·기본)를 정하고 규칙을 보여 준다. 지시서 템플릿의 `{{style}}` 은 `wb-style brief <종류> --owned <파일,…>` 이 채운다. 소유 파일의 문체가 섞이면 파일 묶음마다 한 줄씩 적는다 |
| `/wb:decide` | 소유자가 정할 사항을 고정 선택지 질문으로 만들고 답을 `paths.decisions`(기본 `docs/decisions/<날짜>-<이름>.md`)에 기록한다. `wb-decide new·list·answer`. 커밋은 제안만 하고 직접 하지 않는다 |

**진행 표시.** `wb-work progress` 는 레인 원장에서 일곱 단계(요청 확인, 지시서 준비, 구현, 검수, 취합, 보고, 기록) 중 현재 위치를 한 줄로 보여 준다. 예: `[■■■□□□□] 3/7 구현 중 · 진행 2 · 검수 대기 1`.

**규칙 카탈로그.** `rules/catalog.json` 이 정본이고, 규칙마다 짧은 이름, 내용, 이유, 지키는 위치(훅·도구·지시서 틀·설정), 막혔을 때 복구 방법을 한국어·영어로 적는다. `rules/catalog.ko.md`·`catalog.en.md` 는 `wb-rules render --write` 로, 사용 설명서의 규칙 장 `docs/ko/04-rules.md`·`docs/en/04-rules.md` 는 `wb-rules manual --write` 로 만든다. 차단 메시지의 코드는 `wb-explain code <코드>` 로 해당 규칙과 연결된다. 아직 없는 훅에 걸린 규칙은 「추가 예정」으로 표시한다. `wb-rules list|show|code|render|manual|check`.

**문체 규칙.** `rules/writing-style.ko.md`·`.en.md` 에 문체별 규칙을 둔다. 기본 매핑은 `docs/**/*.md` → 보고서체이며, 화면 문구 경로는 프로젝트가 `style.map` 에 추가한다.

## 코드 색인(codegraph)

codegraph 는 선택 도구다. 설치돼 있지 않으면 아래 훅과 명령은 아무것도 하지 않고, `wb-index` 는 설치 방법만 알려 준다. 설치는 `/wb:init` 에서 사용자 동의를 받은 뒤에만 한다. `WB_CODEGRAPH=off` 로 이 기능 전체를 끌 수 있고, `WB_CODEGRAPH=<경로>` 로 실행 파일을 지정할 수 있다.

**색인 대기열.** 색인은 새 워크트리를 만들 때 함께 만든다. 작업이 몰려도 한 번에 하나씩, 낮은 우선순위(`nice`)로, 무거운 실행 슬롯 안에서 돌린다. 따라서 1분 부하가 `machine.load.max` 이상이면 기다린다.

```
wb-index add [경로]         # 대기열에 넣고 작업 프로세스를 띄운다(기본: 현재 체크아웃)
wb-index status             # 대기 중인 항목, 작업 프로세스, 최근 결과
wb-index run                # 대기열을 지금 이 터미널에서 처리
wb-index drop <경로>        # 대기열에서 빼고 그 경로의 .codegraph 를 지운다
wb-index orphans [--apply]  # 워크트리가 아닌 폴더에 남은 색인과 크기, --apply 로 색인만 삭제
wb-index metrics [--days N] # codegraph 응답 분류 집계
```

- 같은 저장소의 다른 워크트리(주 체크아웃 우선)에 색인이 있으면 그 색인을 복사한 뒤 `codegraph sync` 로 바뀐 파일만 다시 읽는다. 색인은 상대 경로와 파일 내용 해시로 저장되므로 경로가 달라도 쓸 수 있다. 복사는 `sqlite3` 가 있으면 일관된 스냅숏(`.backup`)으로, 없으면 DB 와 WAL 파일을 복사한다. 복사한 색인이 열리지 않거나 sync 가 실패하면 지우고 `codegraph init` 으로 새로 만든다. 데몬 파일(pid·소켓·로그)은 복사하지 않는다.
- 색인 폴더(`.codegraph/`)는 `<git-common-dir>/info/exclude` 에 추가해 git 상태에 나타나지 않게 한다. 이 처리가 없으면 git 이 추적하지 않는 파일이 있다는 이유로 워크트리 삭제를 거부한다. `wb-worktree remove` 는 `.codegraph/` 만 남은 경우를 미커밋 변경으로 보지 않고, 워크트리를 지우기 전에 색인을 지운다.
- 대기열 파일은 `~/.wb/run/codegraph/queue.json`(머신 공용), 작업 기록은 같은 폴더의 `worker.log` 다.
- 자동 등록은 `wb-worktree create`, 선택 기능인 WorktreeCreate 훅, 색인 없는 체크아웃에서의 grep, 색인 없음 응답 네 곳에서 일어난다. `project.codegraph.auto_index`(기본 `true`)를 `false` 로 두면 모두 끈다(`wb-index add` 는 그대로 쓸 수 있다). 옛 이름 `index_on_worktree` 는 한 판 동안 별칭으로 읽고, 두 이름이 함께 있으면 `auto_index` 를 따른다. `/wb:doctor` 가 옛 이름을 쓰는 설정을 알려 준다.

**훅.**

| 시점 | 스크립트 | 동작 |
|---|---|---|
| PreToolUse(Bash·Grep) | `codegraph/nudge` | 색인이 있는 체크아웃에서 식별자 하나(함수·타입·상수 이름)를 grep 하면 세션에 한 번 「호출처는 `codegraph_callers` 한 번으로 감싸는 함수까지 나온다」고 알린다. grep 은 막지 않는다. 색인이 없는 체크아웃이면 알리지 않고 대기열에 넣는다. `project.codegraph.nudge: "off"` 로 끈다 |
| PreToolUse(codegraph MCP) | `codegraph/deadpath` | 이 세션에서 「색인 없음」 응답을 받은 경로로 다시 부르면 막는다(「색인 없음 · 대기열 등록 · grep 으로 진행」). 그 사이 색인이 생기면 다시 허용한다 |
| PostToolUse · PostToolUseFailure(codegraph MCP) | `codegraph/record` | 응답을 정상·빈 결과·미초기화·미적재·기타 오류로 분류해 `<주 체크아웃>/.wb/metrics/codegraph.jsonl` 에 한 줄씩 남긴다. 색인 없음 응답이면 경로를 표시하고 대기열에 넣은 뒤 grep 으로 진행하라고 바로 알린다 |
| SessionStart | `codegraph/session-start` | codegraph 가 설치돼 있으면 짧은 사용 지침(`rules/codegraph.{ko,en}.md`)을 넣는다 |

지침의 요지는 「흐름·호출처·변경 영향은 codegraph, 정확한 줄 번호와 문자열은 grep」이다. Vue `watch` 콜백 안의 호출과 배열로 등록하는 라우트는 그래프에서 빠질 수 있어 grep 으로 한 번 더 확인하게 한다. `/wb:init` 이 `.wb/briefs/` · `.codegraph/` · `.wb/metrics/` 를 `info/exclude` 에 미리 넣는다(이미 있으면 생략). init 을 거치지 않은 저장소에서는 훅·작업 프로세스가 처음 쓸 때 추가하고, `/wb:doctor` 가 그 사실을 한 줄로 알린다. 훅은 모두 오류가 나면 통과시킨다.

**점검.** `/wb:doctor` 는 codegraph 설치 여부, 현재 체크아웃의 색인 유무, 대기열(대기·진행·최근 실패), 워크트리가 아닌 폴더에 남은 색인의 개수와 크기를 보여 준다.

## 보안과 한계

자세한 내용은 [SECURITY.md](SECURITY.md) 에 있다. 요점은 다음과 같다.

- 훅과 명령은 외부로 데이터를 보내지 않는다. 예외로 안전 훅은 `gh pr merge` 앞에서 대상 브랜치를 알기 위해 `gh pr view` 를 실행하고, 확인하지 못하면 병합을 막는다. 검수의 화면 확인은 이 머신의 주소(`localhost`·`127.0.0.0/8`·`[::1]`)만 읽는다.
- 안전 훅은 판정하지 못하면 막고, 나머지 훅은 오류가 나도 작업을 막지 않는다. 훅마다의 동작은 SECURITY.md 의 표에 있다.
- 안전 훅은 명령 문자열을 판정한다. 스크립트 파일 안의 명령, 다른 언어(python·node)로 실행하는 git·kill 호출, Bash 로 설정 파일을 고치는 경우는 판정 범위 밖이다.
- 오너 허가 파일은 같은 머신의 다른 프로세스가 직접 쓰는 경우까지 막지는 못한다. 실수를 줄이기 위한 장치다.
- 셸로 실행하는 명령은 사용자나 프로젝트 설정이 적은 것뿐이다(`wb-slot` 으로 감싼 명령, `review.guards`, `worktree.setup`, 게이트 단계). 다른 사람의 저장소를 열 때는 `.wb/` 의 설정 명령을 먼저 확인한다.
- 토큰 가드는 `~/.claude.json` 에서 공식 사용량 항목(`cachedUsageUtilization`)과 계정 ID 만 읽고, `~/.claude/projects` 의 대화 기록에서 토큰 사용량 필드와 사용 한도 거절 기록을 읽는다. 공식 사용량도 예산도 없으면 훅은 대화 기록을 읽지 않는다. 대화 본문과 인증 정보는 읽거나 저장하지 않는다.

## 개발

```
npm test          # node:test 단위 시험
npm run validate  # claude plugin validate --strict
```

## 라이선스

MIT. [LICENSE](LICENSE) 를 참고한다. wb 가 포함하지 않고 설치만 안내하는 도구의 라이선스는 [SECURITY.md](SECURITY.md) 에 있다.
