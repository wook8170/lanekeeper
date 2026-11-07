# 기능 안내

Lanekeeper 의 기능은 세 가지 방식으로 동작한다. 훅은 Claude Code 가 도구를 실행하기 전후에 자동으로 판정한다. `lanekeeper-*` 명령은 사람이나 Claude 가 직접 실행한다. 스킬(`/lanekeeper:<이름>`)은 Claude 에게 정해진 순서로 명령을 실행하게 하는 작업 안내다.

이 문서는 기능별로 언제 쓰는지와 어떻게 쓰는지를 설명하고, 끝에 스킬 28개를 하나씩 정리했다. 설정 키의 기본값과 뜻은 [설정](03-configuration.md), 규칙별 이유와 복구 방법은 [규칙 안내](04-rules.md)에 있다.

**동작 범위.** 안전 훅은 모든 저장소에서 동작한다. 나머지 작업 훅은 `.lanekeeper/config.json` 이 있는 저장소(또는 그 저장소의 워크트리)에서만 동작한다. 환경 변수 `LANEKEEPER_ACTIVE=1` 을 두면 모든 저장소에서 켜지고, `LANEKEEPER_ACTIVE=0` 을 두면 모두 꺼진다. 핸드오프·토큰 가드·자동 재개·간결 모드는 Claude Code 설정에 같은 종류의 훅이 있으면 꺼진다(`personal.global_hooks`). 세션을 시작할 때는 기본으로 `progress.md` 의 첫 절만 넣는다(`personal.handoff.inject`).

## 1. 기능 한눈에 보기

| 기능 | 동작 방식 | 관련 명령·스킬 |
|---|---|---|
| 모델 라우팅·디스패치 검사 | 서브에이전트를 보낼 때 훅이 모델과 지시서를 검사 | `lanekeeper-route`, `lanekeeper-check brief` |
| 안전 훅 | git·프로세스 종료·삭제·브라우저·경로 쓰기를 실행 전에 판정 | `/lanekeeper:approve` |
| 실행 슬롯·포트·레인 워크트리 | 무거운 실행 수 제한, 레인별 포트, 레인 작업 폴더 | `lanekeeper-slot`, `lanekeeper-port`, `lanekeeper-worktree`, `lanekeeper-reap` |
| 레인 원장·진행판·재개 | 웨이브와 레인 상태 기록, 중단된 레인 재개 | `lanekeeper-waves`, `/lanekeeper:lanes`, `/lanekeeper:resume`, `/lanekeeper:pickup` |
| 진행 기록 | `progress.md` 를 현재 상태로 유지, 끝난 내용은 아카이브 | `lanekeeper-waves handoff` |
| 시험 결과 엑셀·케이스 원장 | 통합 검증 결과를 xlsx 로 저장, 시험 케이스와 결함 관리 | `lanekeeper-test-report`, `lanekeeper-cases`, `lanekeeper-defects`, `/lanekeeper:test-report` |
| 품질 결과 보관·출하 검증 관문 | 종류별 시험 결과를 버전·날짜별로 보관, 출하 검증 전 선행 검증 확인 | `lanekeeper-quality`, `/lanekeeper:quality-unit` 등 품질 스킬, `/lanekeeper:ship-verify`, `/lanekeeper:quality-report` |
| 문서 현행화 | 화면·기능 변경에서 고칠 문서를 찾아 초안·재촬영·검사까지 진행, 필수 문서를 안 고친 변경을 막음 | `lanekeeper-docs`, `/lanekeeper:docs-sync` |
| 검수·취합·보고 | 9항목 검수, 규칙 기반 병합, 아티팩트 보고 | `lanekeeper-check lane`, `lanekeeper-integrate`, `lanekeeper-art`, `/lanekeeper:review-lane`, `/lanekeeper:integrate`, `/lanekeeper:report` |
| 시안 먼저 | 화면 구조 변경을 결정 기록 전에 막음 | `lanekeeper-decide`, `/lanekeeper:decide` |
| 초보자 계층 | 한 줄 요청 안내, 막힌 이유 설명, 문체 지정 | `/lanekeeper:work`, `/lanekeeper:explain`, `/lanekeeper:writing-style` |
| 코드 색인 | codegraph 색인 대기열, 사용 안내 | `lanekeeper-index` |
| 세션 보조 | 토큰 가드, 자동 재개, 간결 모드, 체크포인트 | `lanekeeper-token`, `lanekeeper-retry`, `lanekeeper-terse`, `/lanekeeper:token-guard`, `/lanekeeper:auto-retry`, `/lanekeeper:terse` |
| 설정 점검 | 설정 오류와 값의 출처 확인 | `lanekeeper-config`, `/lanekeeper:init`, `/lanekeeper:doctor` |

## 2. 모델 라우팅과 디스패치 검사

작업 종류마다 쓸 모델의 순서(대체 순서)와 최소 등급이 `routing.json` 에 있다. 대체 순서에서 금지 모델과 사용 한도에 걸린 모델을 빼고, 남은 첫 모델이 최소 등급 이상이면 그 모델을 쓴다. 최소 등급 아래만 남으면 작업을 보내지 않고 리셋 시각까지 기다린다.

기본 작업 종류는 11가지다. 무게(`weight`)는 부하 단계의 「가벼운 작업만」 구간에서 새 레인을 띄울 수 있는지를 정한다. `light` 는 시험·빌드·설치 같은 무거운 실행이 없는 종류다.

| 작업 종류 | 용도 | 대체 순서 | 최소 등급 | 무게 |
|---|---|---|---|---|
| `design` | 설계·분석·계획 | opus | opus | light |
| `review` | 검수·판정 | opus | opus | light |
| `security` | 보안 검토 | opus | opus | light |
| `adversarial` | 반대 입장 검토. 구현 모델은 뺀다 | opus | opus | light |
| `impl-multi` | 여러 파일 구현 | opus → sonnet | sonnet | heavy |
| `impl-spec` | 명세가 확정된 구현 | sonnet → opus | sonnet | heavy |
| `docs` | 문서 작성·현행화(지시서 틀 docs) | sonnet → opus | sonnet | light |
| `mockup` | 시안 | opus → sonnet | sonnet | light |
| `defect-history` | 결함 이력 분석 | sonnet → opus | sonnet | heavy |
| `mechanical` | 기계적 편집 | haiku → sonnet | haiku | light |
| `research` | 읽기 전용 조사 | haiku → sonnet | haiku | light |

결과를 미리 보는 명령은 다음과 같다.

```
lanekeeper-route tasks                                  작업 종류별 대체 순서와 최소 등급
lanekeeper-route resolve impl-multi                     쓸 모델. 대기면 종료 코드 3
lanekeeper-route explain review --implementer opus      단계별 판정 과정
lanekeeper-route check review --model sonnet            모델 선택 판정. 차단이면 종료 코드 1
```

```
작업 종류 review · 사슬 opus · 바닥선 opus
  1 금지: -
  2 한도 소진: -
  3 구현 모델 제외: -
  4 바닥선 미만: -
결과: opus (model: "opus")
```

**디스패치 검사.** Claude 가 Agent 도구로 서브에이전트를 보낼 때 훅이 다음을 확인한다. 지시서 첫 줄 표지(`<!-- lanekeeper-brief v1 type=<작업 종류> lane=<레인> template=<틀> -->`), 필수 절(목표·범위·금지·시험 규칙·보고 위치·커밋 규칙), 채우지 않은 `{{…}}` 자리, `model` 지정, 금지·한도 소진 모델, 최소 등급, 동시 레인 수다. 하나라도 어긋나면 막고 라우팅 결과를 알려 준다. `fork`·`claude-code-guide`·`statusline-setup` 에이전트는 지시서 검사를 건너뛴다(`project.dispatch.exempt_agents`).

**지시서 틀.** `templates/briefs/ko`, `templates/briefs/en` 에 7종(impl·fix·mockup·research·review·docs·test)이 있다. `lanekeeper-style brief <틀> --owned <파일,…> --var 이름=값` 으로 채우고 `lanekeeper-check brief <파일>` 로 점검한다.

## 3. 안전 훅

Bash·Write·Edit·MultiEdit·NotebookEdit·Skill 호출을 실행 전에 판정한다. 결과는 허용, 확인 요청, 차단 중 하나다. 훅 입력에 서브에이전트 표시가 있거나 대상 워크트리가 레인 대장에 있으면 레인으로, 그 밖은 메인 세션으로 본다.

| 대상 | 주요 판정 |
|---|---|
| git | 레인은 자기 브랜치에만 커밋한다. `project.lanes.commit` 이 `on-instruction` 이면 지시서에 커밋 허용 표식(`commit=allowed`)이 있을 때만 커밋하고, 없으면 확인 요청이다. push·병합·브랜치 이동은 레인에게 막힌다. 보호 브랜치 커밋·병합·push 는 소유자 허가가 있어야 한다. 강제 push 는 누구도 못 한다. `reset --hard`·`clean -f`·`branch -D`·이름 없는 stash 는 확인 요청이다 |
| 프로세스 종료 | `pkill`·`killall` 처럼 이름으로 끄는 명령은 막는다. `kill <PID>` 는 대상이 보호 포트를 쓰면 막는다 |
| 삭제 | 홈·시스템 폴더·프로젝트 루트·`.git` 를 지우는 `rm -r` 는 막는다. 프로젝트 밖은 확인 요청이다 |
| 브라우저 | 창이 뜨는 Chrome, `--headed`, `playwright codegen`, 브라우저로 여는 `open` 은 막는다 |
| 경로 | `project.protected_paths` 와 Lanekeeper 상태 파일 쓰기는 막는다. Lanekeeper 설정 파일 수정은 확인 요청이다 |
| 보호 데이터 | `project.protected_data` 의 DB 파일·DB 포트·컨테이너에 쓰는 명령(쓰기 SQL 을 보내는 psql·mysql·sqlite3, `pg_restore`, 쓰기 `docker exec`, `docker cp`, 파일 덮어쓰기)은 레인에게 막히고 메인 세션은 확인 요청이다. SQL 을 읽을 수 없으면(`-f` 파일, 입력 재지정, 대화형) 확인 요청이고, 읽기 질의는 통과한다 |

명령은 `;` `&&` `|`, 서브셸, `sh -c`, `eval`, 별칭, `git -C`, `cd` 를 풀어서 판정한다. 대상을 실행 전에 알 수 없는 명령(명령 이름이 변수인 경우 등)은 막는다. 설정 파일에 오류가 있으면 위험한 명령은 모두 막는다.

예시(메인 세션, 통합 브랜치에서 실행):

```
$ pkill -f vite
[lanekeeper] 막았습니다: 이름·패턴으로 프로세스를 끄면(`pkill`) 다른 세션이나 소유자의 서버까지 꺼질 수 있습니다.
이렇게 고치세요: 자기가 띄운 프로세스의 PID 를 확인해 `kill <PID>` 로 끄세요.
물어볼 곳: `/lanekeeper:doctor` 를 실행하거나 README 의 「안전 훅」 절을 보세요. 규칙을 바꿀 수 있는 사람은 저장소 소유자입니다.

$ git push origin lanekeeper/search/int
[lanekeeper] 확인이 필요합니다: 기능 브랜치 push 는 확인 후 진행합니다(설정 `project.git.feature_push: ask`).

$ git reset --hard HEAD~1
[lanekeeper] 확인이 필요합니다: `git reset --hard` 는 커밋하지 않은 변경을 되돌릴 수 없게 지웁니다(현재 `lanekeeper/search/int`).
```

**소유자 허가.** 보호 브랜치 반영에는 소유자 허가가 필요하다. 소유자는 프롬프트에 `/lanekeeper:approve merge-main`(또는 `push-main`, `commit-main`)을 입력하거나, 메인 세션에서 `lanekeeper-grant` 가 띄운 확인 창에서 허용한다. 허가는 15분 동안 한 번, 허가한 시점의 커밋에만 유효하다. Claude 는 이 스킬을 부를 수 없고 허가 파일을 쓸 수도 없다. 소유자의 다른 결정 세 가지(약화 결과 승인, 자동 재개의 `bypassPermissions`, 오래된 게이트 잠금 삭제)도 같은 명령으로 받는다. 약화 결과 승인과 잠금 삭제는 메인 세션의 확인 창으로도 할 수 있다. `bypassPermissions` 는 슬래시 명령으로만 받는다.

**검사 범위 밖.** 안전 훅은 명령 문자열만 판정한다. 그래서 스크립트 파일 안의 명령이나 python·node 로 실행하는 git 호출은 판정하지 않는다. 감싸는 명령은 정해진 목록만 풀고, 목록에 없는 명령 안의 명령은 판정하지 못한다. 이 훅은 로컬 방어선이어서 서버 쪽 브랜치 보호를 대신하지 않는다.

## 4. 실행 슬롯·포트·레인 워크트리

**실행 슬롯.** 전체 시험·빌드·설치·e2e·색인 같은 무거운 실행과 헤드리스 브라우저는 머신 전체에서 개수를 센다. 기본값은 무거운 실행 2개, 브라우저 2개다. 빈 슬롯이 없거나 1분 부하가 문턱(기본 논리 코어 수 × 2) 이상이면 기다린다.

```
lanekeeper-slot --kind heavy -- pnpm -r test
lanekeeper-slot --kind heavy,browser -- pnpm exec playwright test
lanekeeper-slot status
lanekeeper-slot reap
```

```
1분 부하 3.79 / 문턱 20
heavy: 0/2 사용 중
browser: 0/2 사용 중
```

Claude 가 무거운 명령을 슬롯 없이 실행하면 기본값(`machine.slots.guard: warn`)에서는 실행은 그대로 두고, 슬롯으로 감싼 명령을 알려 준다. `deny` 로 바꾸면 실행을 막는다. 파일 하나만 돌리는 시험(`vitest run a.test.ts`)은 무거운 실행으로 보지 않는다.

```
[lanekeeper] `pnpm exec playwright test` 은(는) 무거운 실행이라 슬롯(browser,heavy) 안에서 돌려야 합니다. 다음처럼 감싸서 다시 실행하세요: `lanekeeper-slot --kind browser,heavy -- sh -c 'pnpm exec playwright test'`
```

**부하 단계.** 1분 부하를 세 문턱(`machine.load.tiers`)과 비교한다. 기본값 `auto` 는 논리 코어 수를 따른다. 가벼운 작업만 허용은 코어 수 × 1.5, 새 레인 보류는 코어 수 × 2, 무거운 실행 중지는 코어 수 × 2.8 이다(반올림). 코어가 10개면 15, 20, 28 이다. 숫자로 직접 정할 수도 있다(예: 가벼운 작업만 20, 새 레인 보류 35, 무거운 실행 중지 35).

| 단계 | 조건 | 동작 |
|---|---|---|
| 정상 | 가벼운 작업만 허용 문턱 미만 | 제한 없음 |
| 가벼운 작업만 | 가벼운 작업만 허용 문턱 이상, 새 레인 보류 문턱 미만 | 무게가 `light` 인 작업 종류만 새 레인을 띄운다. 무거운 종류는 막는다(`load_light_only`). `fork` 처럼 작업 종류가 없는 디스패치는 무거운 종류로 본다 |
| 새 레인 보류 | 새 레인 보류 문턱 이상 | 새 레인(Agent 디스패치)을 막는다(`load_hold`). lanes.json 에 이미 있는 레인으로 보내는 디스패치는 막지 않는다 |
| 무거운 실행 중지 | 무거운 실행 중지 문턱 이상 | 검수 레인의 무거운 실행을 바로 거부한다(`load_stop_heavy`). 실행 레인과 메인 세션은 기존처럼 `machine.load.max` 아래로 내려갈 때까지 기다린다. 이미 슬롯을 잡은 실행은 멈추지 않는다 |

레인 종류는 lanes.json 의 `role`(`executor` · `verifier`, `lanekeeper-worktree create <id> --role verifier`)로 정한다. 없으면 그 레인 지시서 표지의 `role=` 이나 지시서의 `역할:` 줄을 읽는다. 둘 다 없으면 실행 레인으로 본다. 검수 지시서 템플릿 표지에는 `role=verifier` 가 들어 있다.

`lanekeeper-slot check` 는 부하·단계·레인 수·슬롯 점유·고아 프로세스 후보를 한 화면에 보여 준다. 고아 프로세스는 지워졌거나 lanes.json 에 없는 레인 폴더에서 뜬 vite · tsx · esbuild · vitest · 헤드리스 Chrome 이다. `lanekeeper-slot reap --orphans` 는 목록만 보여 주고, `--kill` 을 붙였을 때만 그 PID 만 하나씩 종료한다. 이 세션의 프로세스와 보호 포트(`machine.ports.protected`, `machine.servers`)에서 연결을 기다리는 프로세스는 사유와 함께 제외한다. 프롬프트를 보낼 때 `machine.load.check_every_min`(기본 30분)마다 부하를 확인하고, 문턱을 넘었을 때만 한 줄을 알린다.

```
lanekeeper-slot check
lanekeeper-slot reap --orphans
lanekeeper-slot reap --orphans --kill
```

**포트.** 보호 포트와 레인 포트 대역의 숫자는 머신 설정(`~/.lanekeeper/machine.json`)에만 둔다. 문서와 지시서는 이름만 쓰고 `lanekeeper-port get <이름> [--lane <레인>]` 으로 숫자를 얻는다. 레인 대역은 41000 부터 레인마다 20칸이다. 레인마다 이름별 포트(web·web2·api·db·aux)를 빌려 준다.

```
lanekeeper-port list
```

```
보호 포트 0개
레인 대역: 시작 41000, 간격 20, 이름 web,web2,api,db,aux, 최대 9레인
임대 0건
```

**레인 워크트리.** `lanekeeper-worktree create <레인>` 은 통합 브랜치 HEAD 에서 레인 브랜치와 작업 폴더를 만들고, 포트를 빌리고, 레인 대장에 등록한다. `.worktreeinclude` 에 적힌 git 무시 파일(예: `.env`)을 복사하고, `project.worktree.setup` 에 적은 설치 명령을 슬롯 안에서 실행한다. 정리하지 않은 레인이 상한(기본 3)에 닿으면 만들지 않는다.

```
lanekeeper-worktree create l1
lanekeeper-worktree list
lanekeeper-worktree remove l1 [--force] [--delete-branch]
```

지울 때 그 폴더 안에서 도는 프로세스가 있으면 지우지 않고 PID 목록을 보여 준다. 하나씩 `kill <PID>` 로 끈 뒤 다시 실행한다.

**Claude Code 워크트리 훅(선택).** `/lanekeeper:init` 에서 예라고 답하거나 `project.worktree.hook` 을 `true` 로 두면, Claude Code 가 워크트리를 만들 때(`claude --worktree`, 서브에이전트 `isolation: "worktree"` 등) Lanekeeper 의 방식을 쓴다. 이 훅은 이 머신의 `.claude/settings.local.json` 에 등록된다. 등록되면 Claude Code 의 기본 워크트리 생성 방식을 쓰지 않고 이 훅만 쓴다. 상태는 `lanekeeper-worktree hooks status` 로 확인하고, 바로 반영하려면 `lanekeeper-worktree hooks sync` 를 실행한다.

**정리.** `lanekeeper-reap` 은 끝난 슬롯 임대를 회수하고, 폴더가 없어진 레인의 포트 임대와 대장 항목을 보여 준다. `--apply` 를 주면 정리한다. 프로세스는 끄지 않는다.

## 5. 레인 원장·진행판·재개

웨이브와 레인의 상태는 `<git 공용 폴더>/lanekeeper/waves.json` 에 기록하며, 모든 워크트리가 같은 파일을 쓴다. 기록은 `lanekeeper-waves` 로만 한다. JSON 을 직접 고치지 않는다.

```
lanekeeper-waves init-wave w1 --title "목록 검색 상자"
lanekeeper-waves lane w1 l1 --task impl-multi --model opus --brief .lanekeeper/briefs/l1.md --todo "검색 상자 추가"
lanekeeper-waves board
lanekeeper-waves metrics
```

훅은 디스패치 검사를 통과한 호출, 서브에이전트 시작, 서브에이전트 종료를 원장에 자동으로 반영한다. 지시서 표지의 `lane=` 값으로 레인을 찾는다. 레인이 끝나면 상태가 「검수 대기」가 되고, 검수에서 되돌리면 되돌림 횟수가 1 늘어난다.

레인 상태는 대기·진행·검수 대기·막힘·실패·완료 여섯 가지다. 진행판의 `*` 는 에이전트가 지금 돌고 있다는 뜻이다. 플러그인은 서브에이전트 상태줄에 `lanekeeper 1/3 실행 · l1:진행` 같은 한 줄을 보여 준다.

**재개.** 세션이 끊기거나 한도에 걸린 뒤에는 `/lanekeeper:resume` 이 `lanekeeper-waves resume` 보고를 만든다. 이 보고는 `progress.md`, git 상태, 워크트리 목록, 최근 커밋, 레인 판정, 오래된 항목을 한 번에 보여 준다. 멈춘 레인은 `lanekeeper-waves resume --prompt w1/l1` 이 만든 문구로 같은 워크트리에 다시 보낸다.

## 6. 진행 기록(progress.md)과 아카이브

`progress.md` 는 지금 유효한 상태만 담는다. 기준은 300줄 이하다. 맨 위에 아카이브 위치와 검색 방법 한 줄을 두고, 목표와 오너 결정 · 브랜치와 서버 · 진행 중(표) · 다음 할 일 · 확인 대기 · 시스템 지식 · 재개 명령 절을 쓴다.

| 시점 | 훅이 하는 일 |
|---|---|
| 세션 시작·`/clear` | `progress.md` 전체와 아카이브 검색 방법을 대화에 넣는다 |
| 턴 종료 | 마지막 갱신 뒤에 커밋이나 파일 변경이 있으면 한 번 막고 인계를 요구한다. 같은 세션은 20분 동안 다시 막지 않는다 |
| 기준 줄 수 초과 | 세션 시작·종료·재개 보고에서 알리고 `lanekeeper-waves handoff migrate` 를 안내한다 |

끝난 내용(완료한 웨이브, 해소된 확인 대기)은 `docs/progress-archive/progress-<YYYY-MM>.md` 끝에 날짜 절로 덧붙인다. 이력은 지우지 않는다. 필요한 부분은 `grep -n '<키워드>' docs/progress-archive/*.md` 로 찾는다.

```
lanekeeper-waves handoff check                      줄 수와 아카이브 목록. 기준 초과면 종료 코드 1
lanekeeper-waves handoff archive "<요지>"           지금 progress.md 전체를 이번 달 아카이브 끝에 덧붙임
lanekeeper-waves handoff migrate                    기준을 넘은 누적형 파일을 아카이브로 옮기고 새 양식으로 만듦
```

`progress.md` 가 없는 저장소에서는 인계 훅이 동작하지 않는다. 처음 한 번은 직접 만든다.

## 7. 시험 결과 엑셀과 케이스 원장

통합·최종 검증 결과를 엑셀(xlsx)과 요약 json 으로 남긴다. Python 3.8 이상과 openpyxl 이 필요하다. 없으면 설치 명령을 안내하고 엑셀만 건너뛴다. 엑셀은 게이트 통과의 조건이 아니다. 그래서 엑셀을 만들지 못해도 게이트와 모든 단계가 통과하면 게이트 통과 표식을 남기고, 엑셀 경고는 한 줄 안내로만 나온다.

```
lanekeeper-test-report env                          준비 확인
lanekeeper-test-report init                         .lanekeeper/verify.config.json 생성
lanekeeper-test-report run --name integration       게이트 → 단계별 시험 → 엑셀(전체 통과면 게이트 통과 표식)
lanekeeper-test-report gate-pass                    project.gate.command 실행, 통과하면 게이트 통과 표식
lanekeeper-test-report summary [--json]             최신 결과 수치
lanekeeper-check test-results                       최신 결과가 있고 커밋됐는지 확인
```

단계(`stages`)마다 결과 형식(`adapter`: vitest · jest · playwright · pytest), 종류(`kind`: unit · integration · e2e · uistab), 명령(`cmd`, `{file}` 자리에 결과 파일 경로가 들어간다), 슬롯(`slot`: heavy · `heavy,browser` · none)을 적는다. 앞 단계가 실패해도 모든 단계를 돌린다. 실행 중에는 게이트 잠금(`<git 공용 폴더>/lanekeeper/gate.lock`)을 잡아 병합을 기다리게 한다.

엑셀 시트는 요약 · 단위 · 통합 DB · e2e · e2e 상세 · UI 안정성 · gate 단계 · 실패 목록 · 간헐 실패 · 원장 대조 · 커버리지 · 변이다. 결과가 없는 시트는 만들지 않는다. 시트 이름·머리글·요약 문구는 `personal.language` 설정을 따른다(`ko` 는 위 이름, `en` 은 Summary · Unit · Integration DB · e2e · e2e detail · UI stability · Gate steps · Failures · Flaky · Ledger comparison · Coverage · Mutation). 저장 위치는 `docs/test-results/<날짜>/<이름>-<HHMM>.xlsx` 이며 커밋한다.

**케이스 원장과 결함 대장.** `docs/e2e/<모듈>.cases.json` 과 `defect-register.json` 을 `lanekeeper-cases`, `lanekeeper-defects` 로 관리한다. 케이스 ID 는 다시 쓰지 않는다. 고칠 수 없는 결함은 시험을 약하게 바꾸지 않고 결함으로 등록한 뒤 케이스를 보류(`fixme`)로 둔다.

```
lanekeeper-cases init search --prefix SRCH
lanekeeper-cases add search --title "검색어 입력" --expected "일치 항목만 보임" --priority P1
lanekeeper-defects add --title "빈 검색어에서 목록이 사라짐" --severity high --case SRCH-001
lanekeeper-cases set search SRCH-001 --status fixme --defect D-001
lanekeeper-cases check
```

원장이 있으면 원장과 실행 결과의 불일치를 엑셀의 「원장 대조」 시트에 적는다. 불일치가 0 이어야 출하 판정을 한다.

**종류별 결과 보관과 출하 검증 관문.** `lanekeeper-quality` 는 시험 종류(단위·통합·게이트·e2e·UI 안정성·사용성·UX 적대 점검·출하 검증)마다 결과를 따로 남긴다. 명령은 프로젝트 설정 `quality.suites` 에 종류별로 적는다(명령, 결과 형식 `parser`, 슬롯, 임계 파일, 낡음 판정 경로). 결과는 공통 머리 JSON 과, 같은 내용의 엑셀로 `docs/test-results/<버전>/<날짜>/<종류>-<HHMM>.json`·`.xlsx` 에 저장한다. 공통 머리에는 종류·버전·커밋·브랜치·시작·끝·환경·판정·총·통과·실패·건너뜀·보류·간헐·원자료 위치가 들어간다. 버전은 `quality.version_file`(기본 `VERSION`)에서 읽는다. 로그 같은 원자료는 `quality.raw_root` 에 두고 커밋하지 않는다. 결과 폴더의 `index.json`·`INDEX.md` 는 결과 파일을 훑어 다시 만드는 색인이다. 이전 형식의 날짜 폴더(`docs/test-results/<날짜>/`)는 옮기지 않고 색인에 「이전 형식」으로 올린다.

출하 검증(`quality.ship.skills`·`quality.ship.agents`)을 시작하기 전에 `quality.ship.requires` 의 종류마다 최신 결과를 확인한다. 결과가 없거나(없음), 다른 커밋의 결과이거나 커밋하지 않은 변경이 있는 상태에서 돌았거나(낡음), 통과하지 못했으면(실패) 관문이 막는다. 이렇게 막힌 종류는 `lanekeeper-quality precheck --run` 이 다시 돌린다. 직전 통과 결과보다 시험 수가 줄었거나, 건너뜀·보류가 늘었거나, 임계 파일이 바뀌거나 완화됐으면(약화) 다시 돌려도 풀리지 않는다. 의도한 변경이면 저장소 소유자가 프롬프트에 `/lanekeeper:approve accept-quality <종류> --reason 사유` 를 입력해 승인한다. 결과 폴더 안의 파일만 바뀐 커밋은 같은 커밋으로 본다.

`quality.ship.advisory`(기본 `["ux-adversarial"]`)의 종류는 같은 방식으로 확인하지만 막지 않고 경고만 한다. UX 적대 점검을 출하 전에 하지 않았거나(수동·없음), 최신 결과에 해결하지 않은 차단 발견이 있으면(실패) 관문 표 아래와 훅 안내에 경고가 나온다. 막게 하려면 그 종류를 `quality.ship.requires` 로 옮기고, 경고가 필요 없으면 `[]` 로 둔다.

```
lanekeeper-quality list                             설정된 종류와 명령
lanekeeper-quality run unit                         한 종류를 슬롯으로 실행 → JSON·엑셀·색인
lanekeeper-quality run --category e2e               한 범주의 종류를 모두 실행
lanekeeper-quality record usability --verdict passed --from result.json
                                            에이전트가 한 시험(사용성, 출하 판정)을 기록
lanekeeper-quality status                           출하 검증 관문 표(실행하지 않음)
lanekeeper-quality precheck --run                   빠졌거나 낡았거나 실패한 종류를 돌린 뒤 판정, 막히면 종료 코드 1
lanekeeper-quality report                           버전 취합본 quality-<버전>.xlsx·md·html
lanekeeper-quality index                            색인 다시 만들기
```

**문서 현행화.** 화면·기능을 고치면 매뉴얼·안내서·도움말·화면 문구·제품 소개·스크린샷·변경 기록이 함께 바뀌어야 한다. `lanekeeper-docs` 는 기준 브랜치(`docs_sync.base`)와의 merge-base 부터 작업 트리까지의 변경으로 영향 지도를 만든다. 대상(`docs_sync.targets`)마다 「필수」와 「검토」를 판정한다. 필수는 화면 코드에서 사라진 문구가 아직 남아 있는 문서 줄, 짝 파일(`mirrors`)의 다른 쪽, 묶음(`groups`)의 나머지, 규칙(`rules`)이 요구한 생성 문서다. 검토는 바뀐 화면 부분의 문구가 나오는 문서, 바뀐 화면의 시험 ID 가 찍힌 촬영 장면(재촬영 후보)과 그 그림이 실린 문서다. 문구는 문자열과 태그 사이 글자에서 뽑는다. 기본은 낱말 두 개 이상이고, `text_pattern` 으로 바꿀 수 있다. 필수 항목을 같은 변경에서 고치지 않으면 `lanekeeper-docs check` 가 종료 코드 1 을 낸다. `docs_sync.targets` 를 설정하면 `lanekeeper-quality` 에 종류 `docs`(범주 gate)가 생겨 출하 검증 관문에 넣을 수 있다.

```
lanekeeper-docs map                                 영향 지도 · 초안 · 재촬영 명령 · 남은 수동 항목(파일을 쓰지 않음)
lanekeeper-docs apply                               해당하는 자동 생성 명령 실행
lanekeeper-docs drafts --out drafts.md              파일별 수정 초안
lanekeeper-docs verify                              검사 명령 실행
lanekeeper-docs check                               관문: 필수 미충족이면 종료 코드 1
```

## 8. 검수·취합·보고

레인이 끝나면 메인 세션은 검수 → 취합 → 보고 순서로 진행한다. 판정은 명령이 하고, 사람은 되돌림을 보낼지와 병합 준비를 마칠지만 정한다.

**검수(`lanekeeper-check lane`).** 레인 보고 파일을 정본으로 읽고 반환 메시지와 대조한다.

| # | 항목 | 실패 조건 |
|---|---|---|
| 1 | 보고 HEAD | 없음, 저장소에 없음, 통합 HEAD 를 조상으로 두지 않음 |
| 2 | 보고 파일 | 없음, 새 HEAD·시험·남은 것 중 빠진 항목, 반환 메시지와 HEAD·통과 수가 다름 |
| 3 | 프로젝트 가드 | `project.review.guards` 명령 실패. 설정이 없으면 건너뜀 |
| 4 | 수정 전 실패 기록 | 코드가 바뀌었는데 수정 전 실패 확인이 보고에 없음 |
| 5 | 지시서 범위 | 지시서의 소유 파일 밖이나 금지 파일을 바꿈 |
| 6 | 캡처 확인 | 화면 변경인데 캡처가 없음, 파일이 없음, 메인이 열어 보지 않음 |
| 7 | 서빙 코드 표식 | 웹 화면 변경인데 서빙 중인 코드에 변경 표식이 없음. 이 머신 주소만 확인한다 |
| 8 | 시험 결과 | 레인: 보고에 통과 수가 없거나 실패가 있음. 통합·최종: 해당 HEAD 의 결과 엑셀이 커밋되지 않음 |
| 9 | 용어 | 용어 검사 결과가 기준선보다 늘었음. 사전이 없으면 건너뜀 |

실패 항목이 있으면 `.lanekeeper/briefs/<레인>-return-<번호>.md` 에 되돌림 지시서를 만든다.

**취합(`lanekeeper-integrate`).** 통합 브랜치를 체크아웃한 폴더에서 레인 브랜치를 하나씩 시험 병합하고 충돌을 분류한다.

| 분류 | 처리 |
|---|---|
| 원장(`*.cases.json`, `defect-register.json`) | `id` 기준 합집합. 같은 id 는 통합 쪽 우선 |
| 등록 파일(`hooks/hooks.json`) | 객체 병합, 목록 합집합 |
| 생성물(`*.xlsx`, 잠금 파일) | 통합 쪽을 받은 뒤 `project.integrate.regenerate` 명령으로 다시 만듦 |
| 코드(그 밖의 파일) | 병합을 중단하고, 레인에 통합 최신을 병합해 오라는 되돌림 지시서를 만듦 |

종료 코드는 0 병합 완료, 1 중단(되돌림 지시서 생성), 2 시작하지 않음(작업 트리가 깨끗하지 않음 등), 3 게이트 실행 중이다.

**보고(`lanekeeper-art`).** 다시 볼 캡처는 `lanekeeper-art keep` 으로 `docs/reports/artifacts/<주제>/` 에 두고 커밋한다. 일회성 캡처는 `lanekeeper-art temp` 로 스크래치에 둔다. `lanekeeper-art report` 는 이미지를 data URI 로 넣은 HTML 한 파일을 만든다. 300KB 를 넘는 PNG 는 WebP 로 줄인다.

```
lanekeeper-art env
변환 도구: cwebp. 300KB 넘는 PNG 를 품질 80 WebP 로 바꿉니다
```

`/lanekeeper:report` 를 실행한 세션이 아티팩트 없이 끝나려 하면 Stop 훅이 한 번 막는다.

## 9. 시안 먼저

화면 파일 범위(`project.mockup.ui_globs`)를 정하면, 그 범위의 화면 구조를 바꾸는 쓰기를 결정 기록 전에 막는다. 범위가 비어 있으면(기본) 동작하지 않는다.

- 구조 변경으로 보는 것: 새 화면 파일, 마크업 요소 구성이 바뀌는 수정, 스타일 시트의 선택자 추가·삭제
- 통과하는 것: 문구, 속성, CSS 속성 값만 바꾸는 수정
- 막힘이 풀리는 조건: `docs/decisions/` 에 `status=decided kind=mockup` 이고 `scope` 가 그 파일을 덮는 결정 문서가 있음

먼저 현재 화면과 대안 시안을 아티팩트로 보여 준다. 그다음 `lanekeeper-decide new … --kind mockup --scope …` 로 질문을 만들고, 선택을 `lanekeeper-decide answer` 로 기록한 뒤 커밋한다. 끄려면 `project.mockup.decision_required` 를 `false` 로 둔다.

## 10. 초보자 계층

레인 흐름을 모르는 사용자가 한 줄 요청으로 시작하고, 막혔을 때 이유를 바로 읽을 수 있게 하는 기능이다.

- `/lanekeeper:work` 는 요청을 종류(고장·기능·화면·문서·조사·큰 설계)로 나누고, 단계와 단계별 모델을 보여 준다. 진행 위치는 `lanekeeper-work progress` 가 일곱 단계 막대(`[■■■□□□□] 3/7 구현 중 · 진행 1`)로 보여 준다.
- `/lanekeeper:explain` 은 지금 막힌 것과 기다리는 것을 쉬운 말로 설명한다. 차단 메시지의 코드는 `lanekeeper-explain code <코드>` 로 규칙과 연결된다.
- `/lanekeeper:writing-style` 은 파일별 문체(해요체·보고서체·기본)를 정한다. `project.style.map` 에서 처음으로 맞는 항목을 적용한다.
- `/lanekeeper:decide` 는 소유자가 정할 사항을 고정 선택지 질문으로 만들고 답을 `docs/decisions/` 에 남긴다.

```
lanekeeper-explain
지금 막힌 것도, 기다리는 것도 없어요.
```

## 11. 코드 색인(codegraph)

codegraph 는 선택 도구다. 설치돼 있지 않으면 세션 시작 때 설치·초기화한 뒤 계속하라는 안내(`rules/codegraph-install.ko.md`)를 넣는다. 나머지 훅과 명령은 동작하지 않는다. `lanekeeper-index` 는 설치 방법만 알려 준다.

- 새 워크트리를 만들면 색인을 대기열에 넣는다. 같은 저장소의 다른 워크트리에 색인이 있으면 복사한 뒤 바뀐 파일만 다시 읽는다.
- 색인 작업은 한 번에 하나씩, 낮은 우선순위로, 무거운 실행 슬롯 안에서 실행한다.
- 색인이 있는 체크아웃에서 식별자 하나를 grep 하면 세션에 한 번 codegraph 사용을 안내한다. grep 은 막지 않는다.
- 「색인 없음」 응답을 받은 경로로 codegraph 를 다시 부르면 막고 grep 으로 진행하라고 안내한다.
- `grep -r` 처럼 재귀로 텍스트를 찾으면 세션에 한 번 `rg` 를 쓰라고 안내한다. 한글 소스는 `rg -a` 로 찾는다. 이 안내는 codegraph 설치 여부와 관계없이 나온다. `personal.search.rg_hint` 를 `false` 로 두면 꺼진다.

```
lanekeeper-index add .          지금 체크아웃을 대기열에 넣음
lanekeeper-index status         대기열과 최근 결과
lanekeeper-index orphans        워크트리가 아닌 폴더에 남은 색인
```

자동 등록을 모두 끄려면 `project.codegraph.auto_index` 를 `false` 로, 안내를 끄려면 `project.codegraph.nudge` 를 `off` 로 둔다. 환경 변수 `LANEKEEPER_CODEGRAPH=off` 는 이 기능 전체를 끈다.

## 12. 토큰 가드·자동 재개·간결 모드·체크포인트

| 기능 | 하는 일 | 관리 |
|---|---|---|
| 토큰 가드 | Claude Code 가 남기는 공식 5시간·7일 사용량을 읽고, 그 뒤 사용분은 로컬 토큰으로 추정해 더한다. 둘 중 높은 비율이 90% 면 작업 단위 축소, 95% 면 웨이브마다 인계, 99% 면 마지막 인계와 알림 후 대기를 지시한다 | `lanekeeper-token`, `/lanekeeper:token-guard` |
| 자동 재개 | 사용량 한도로 턴이 끝나면 리셋 시각 2분 뒤에 같은 세션을 헤드리스로 재개한다. 예약은 macOS launchd, Linux systemd 사용자 타이머, 그 밖에는 백그라운드 대기 프로세스로 한다 | `lanekeeper-retry`, `/lanekeeper:auto-retry` |
| 간결 모드 | 켠 저장소에서 세션 시작 때 출력과 도구 호출을 줄이는 규칙을 넣는다 | `lanekeeper-terse`, `/lanekeeper:terse` |
| 체크포인트 | 한도, 서브에이전트 종료, 대화 압축 시점에 레인 브랜치의 추적 파일 변경을 `wip(lanekeeper)` 커밋으로 남긴다. 비밀 파일 패턴과 추적되지 않은 파일은 커밋하지 않는다. `project.lanes.commit` 이 `on-instruction` 이면 커밋 허용 표식이 있는 레인만 커밋한다 | `personal.checkpoint.enabled` |
| 세션 규칙 | 훅으로 판정할 수 없는 작업 규칙을 세션 시작·`/clear`·대화 압축 뒤에 넣는다. 출력 언어(`personal.language` 가 `ko`·`en` 일 때), 원격 사용자(`personal.report.viewer` 가 `remote` 일 때: 로컬 주소 금지·아티팩트·base64 이미지·2배율 캡처), 보고 정확성·소통·수정 원칙(구현과 반영 구분, 모호하면 되묻기, 근본 원인 수정, 제품 화면 이모지 금지) | `personal.session_rules` |

토큰 가드는 Claude Code 가 `~/.claude.json` 에 저장해 두는 공식 사용량(5시간·7일 비율, 리셋 시각, 계정)을 먼저 쓴다. 이 파일에서는 사용량 항목과 계정 ID 만 읽는다. 공식 값은 Claude Code 가 사용량을 조회할 때만 바뀌므로, 조회한 지 `personal.token_guard.fresh_min`(기본 10분)이 지나면 그 뒤의 로컬 토큰 사용량을 보정 계수로 환산해 더한다. 5시간 창은 리셋 시각 5시간 전에 시작하고, 리셋 시각이 지나면 리셋 이후 사용분만 센다. 판정에는 5시간과 7일 중 높은 비율을 쓴다. 가장 최근 공식 값에 5시간 항목이 없으면(`five_hour: null`) 5시간 한도가 없는 것으로 보고 7일 비율만으로 판정한다. 이전의 5시간 기록과 그 보정 계수는 이어 쓰지 않는다. 그 뒤에 5시간 한도 거절이 대화 기록에 남으면 다시 100% 로 본다. 이 해석은 지금까지 관찰한 응답 형태에 근거하며 정책 문서로 확인하지 않았다. 거절을 찾는 대화 기록 검사는 최근 5시간 범위만 읽는다.

보정 계수는 계정마다 따로 자동으로 계산한다. 공식 값이 바뀔 때마다 그 값을 기록해 두고, 같은 창 안 두 기록 사이의 비율 증가를 그 사이 로컬 사용량으로 나눈다. 기록이 하나뿐이면 창이 시작된 뒤의 로컬 사용량으로 나눈다. 앱의 `/usage` 에서 본 값은 `lanekeeper-token calibrate --five <5시간%> --seven <7일%> [--at HH:MM]` 으로 직접 넣을 수 있다. 사용 한도에 걸린 기록이 대화 기록에 남으면 그 시점을 100% 로 쓴다. 계정을 바꾸면 이전 계정의 공식 값과 보정은 쓰지 않는다.

공식 값이 없으면 종전 방식으로 동작한다. 최근 `window_hours` 시간의 로컬 사용량을 예산(`personal.token_guard.budget`)에 대한 비율로 환산하고, 예산이 0 이면 그 계정의 보정 계수에서 100% 를 환산한다. 둘 다 없으면 가드는 동작하지 않는다. 로컬 사용량에는 이 기기의 Claude Code 사용만 들어간다.

```
lanekeeper-token status
토큰 가드: 켜짐
공식(10-17 22:35, 153분 전, 10분 넘음, 계정 …27441107): 5시간 11% (리셋 10-18 02:59), 7일 54% (리셋 10-24 06:59).
지금 추정: 5시간 56.7% (10-17 22:35 공식 11% + 로컬 45.7%), 7일 68.6% (10-17 22:35 공식 54% + 로컬 14.6%) → 68% (공식 사용량에 조회 이후 로컬 사용 추정을 더한 값), 단계 -.
보정 5시간: 1% ≈ 가중 4,375,643 (창 시작부터, 10-17 21:59 → 10-17 22:35).
보정 7일: 1% ≈ 가중 13,724,352 (창 시작부터, 근사, 10-17 06:59 → 10-17 22:35).
```

자동 재개의 권한 모드 기본값은 `default` 다. 이 모드에서는 승인이 필요한 도구가 무인 실행에서 거절되므로 재개한 작업이 그 지점에서 멈출 수 있다. `bypassPermissions` 는 사람이 프롬프트에 `/lanekeeper:approve retry-bypass` 를 입력할 때만 켜진다. 에이전트는 이 모드를 켤 수 없고, 저장소의 프로젝트 설정으로도 확인을 대신할 수 없다.

## 13. 스킬 28개

스킬은 Claude Code 프롬프트에 `/lanekeeper:<이름>` 으로 입력한다. 설명에 맞는 요청을 하면 Claude 가 스스로 부르기도 한다. 다만 `/lanekeeper:approve` 는 사람이 직접 입력할 때만 동작한다.

| 스킬 | 한 줄 설명 |
|---|---|
| `/lanekeeper:init` | 프로젝트에 Lanekeeper 설정을 만든다 |
| `/lanekeeper:doctor` | 설정 오류, 값의 출처, git·Node.js·codegraph 상태를 점검한다 |
| `/lanekeeper:work` | 한 줄 요청을 레인 흐름으로 바꾸고 끝까지 안내한다 |
| `/lanekeeper:explain` | 막힌 것과 기다리는 것을 쉬운 말로 설명한다 |
| `/lanekeeper:writing-style` | 파일별 문체를 정하고 규칙을 보여 준다 |
| `/lanekeeper:decide` | 소유자 결정을 질문으로 만들고 답을 문서로 남긴다 |
| `/lanekeeper:lanes` | 웨이브·레인 진행판을 보여 주고 기록한다 |
| `/lanekeeper:pickup` | 세션 시작 때 이전 작업을 이어받는다 |
| `/lanekeeper:resume` | 중단된 웨이브를 재개한다 |
| `/lanekeeper:review-lane` | 레인 결과를 9항목으로 검수한다 |
| `/lanekeeper:integrate` | 검수를 통과한 레인을 통합 브랜치에 합친다 |
| `/lanekeeper:test-report` | 검증을 돌리고 결과를 엑셀로 남긴다 |
| `/lanekeeper:quality-unit` | 단위 시험을 돌리고 종류별 결과로 보관한다 |
| `/lanekeeper:quality-integration` | 통합 시험(시험용 DB 등)을 돌리고 보관한다 |
| `/lanekeeper:quality-gate` | 게이트 단계를 하나씩 돌리고 보관한다 |
| `/lanekeeper:quality-e2e` | 종단 시험을 헤드리스로 돌리고 보관한다 |
| `/lanekeeper:quality-uistab` | UI 안정성 하네스를 돌리고 임계 파일과 함께 보관한다 |
| `/lanekeeper:quality-usability` | 초보 사용자 대역 에이전트로 사용성 시험을 하고 기록한다 |
| `/lanekeeper:quality-ux-adversarial` | 분리된 맥락의 점검자가 UX 를 적대적으로 점검하고, 오너 확인 뒤 고친 다음 다시 점검한다 |
| `/lanekeeper:design-adversarial` | 구현 전에 다른 맥락의 검증자가 설계를 적대적으로 검증하고, 구현 뒤 설계 불변식을 확인한다 |
| `/lanekeeper:ship-verify` | 선행 검증 관문을 통과시킨 뒤 출하 검증을 한다 |
| `/lanekeeper:quality-report` | 버전 품질 보고서(엑셀·Markdown·HTML)를 만든다 |
| `/lanekeeper:docs-sync` | 화면·기능 변경에 맞춰 문서·스크린샷을 한 번에 현행화한다 |
| `/lanekeeper:report` | 최종 보고를 아티팩트로 게시한다 |
| `/lanekeeper:approve` | 소유자 결정을 기록한다(사람만 입력): 보호 브랜치 반영 1회, 약화 결과 승인, 자동 재개의 `bypassPermissions`, 오래된 게이트 잠금 삭제 |
| `/lanekeeper:auto-retry` | 한도 뒤 자동 재개를 관리한다 |
| `/lanekeeper:token-guard` | 토큰 가드를 확인·보정한다 |
| `/lanekeeper:terse` | 간결 모드를 켜고 끈다 |

### /lanekeeper:init

- 언제: 저장소에서 Lanekeeper 를 처음 쓸 때.
- 어떻게: 네 가지 질문(프로젝트 종류, 메시지 언어, 전체 검증 명령, Claude Code 워크트리 관리 여부)에 답한다. Claude 가 `lanekeeper-config init` 을 실행하고 `lanekeeper-config doctor` 로 결과를 보여 준다. 기존 파일은 덮어쓰지 않으며 커밋하지 않는다.
- 예시: `/lanekeeper:init` → 「web-ui, ko, npm test, no」라고 답한다. 자세한 출력은 [시작하기](01-getting-started.md) 3절.

### /lanekeeper:doctor

- 언제: 설치 직후, Lanekeeper 가 예상과 다르게 동작할 때, 웨이브를 시작하기 전.
- 어떻게: `lanekeeper-config doctor` 결과를 보여 주고 `✗` 줄마다 원인과 고칠 방법을 설명한다. 특정 값의 출처는 `lanekeeper-config explain <키>` 로 확인한다. 시험 결과 엑셀 환경은 `lanekeeper-test-report env` 로 확인한다. 끝 줄에 실제로 적용되는 부하 문턱(`load.max`, `load.tiers`)이 나온다. 이 스킬은 아무것도 설치하지 않는다.
- 예시: 「machine.lanes.max 가 왜 3 이야?」

```
lanekeeper-config explain machine.lanes.max
machine.lanes.max
  값: 3
  합치는 규칙: 기본값을 뺀 층 중 가장 작은 값
  적용된 층: 기본값
  값을 둔 층:
    - 기본값 (…/defaults/machine.json): 3
```

### /lanekeeper:work

- 언제: 레인 흐름을 모르는 상태에서 일을 한 문장으로 맡길 때.
- 어떻게: Claude 가 요청을 다시 정리해 확인받고, `lanekeeper-work plan` 으로 종류와 단계를 정한다. 레인 워크트리, 지시서, 디스패치, 검수, 취합, 보고, 인계까지 단계마다 한 줄로 알려 준다. 진행 위치는 `lanekeeper-work progress` 로 본다. 보호 브랜치 병합과 push 는 하지 않는다.
- 예시: `/lanekeeper:work 목록 화면에 검색 상자 추가`

| 요청 종류 | 흐름 |
|---|---|
| 고장 | 재현(조사 레인) → 수정과 회귀 시험 → 다른 모델 검수 → 취합 → 보고 |
| 기능 | 지시서 → 구현 → 검수 → 취합 → 보고 |
| 화면 | 시안(현재와 제안) → 소유자 결정 → 구현 → 검수 → 취합 → 보고 |
| 문서 | 지시서 → 문체 규칙대로 작성 → 검수 → 보고 |
| 조사 | 찾아서 보고. 파일은 바꾸지 않는다 |
| 큰 설계 | 개인 설정 `design_plugin` 에 적은 설계 플러그인이 있으면 그 플러그인을, 없으면 Lanekeeper 단계를 안내한다 |

### /lanekeeper:explain

- 언제: 무언가 막혔을 때, 아무것도 진행되지 않을 때, 차단 메시지의 뜻을 알고 싶을 때.
- 어떻게: `lanekeeper-explain` 이 설정 오류, 사용 한도, 게이트 실행 중, 멈춘 레인, 레인 상한, 가득 찬 실행 슬롯, 낡은 인계 파일, 남은 워크트리, 보호 브랜치를 확인한다. 차단 메시지는 `lanekeeper-explain code <코드>` 로 규칙과 연결한다. 읽기만 하며 설정을 바꾸지 않는다.
- 예시: 「방금 pkill 이 왜 막혔어?」

```
lanekeeper-explain code safety.kill.pattern
…
no-pattern-kill — 프로세스는 번호(PID)로만 종료
  프로세스를 이름이나 패턴으로 종료하지 않는다. 자기가 시작한 프로세스만 번호(PID)로 종료한다. …
  막혔을 때: `lsof -i :<포트>` 나 자기 실행 기록에서 PID 를 확인해 그 프로세스만 종료한다. …
```

### /lanekeeper:writing-style

- 언제: 화면 문구, 매뉴얼, 도움말, 보고서를 쓰거나 고칠 때. 지시서의 문체 줄을 채울 때.
- 어떻게: `lanekeeper-style of <경로>` 로 문체를 찾고 `lanekeeper-style rules <문체>` 로 규칙을 읽는다. 지시서는 `lanekeeper-style brief <틀> --owned <파일,…>` 로 채운다.
- 예시: 화면 문구를 해요체로 정하려면 `.lanekeeper/config.json` 에 다음을 넣는다.

```json
"style": { "map": [
  { "glob": "src/**/*.{tsx,vue}", "style": "haeyo" },
  { "glob": "docs/**/*.md", "style": "report" }
] }
```

| 문체 | 대상 | 요지 |
|---|---|---|
| `haeyo` | 화면 문구, 인앱 매뉴얼, 도움말 | 짧은 존댓말, 한 화면 한 주제, 질문형 제목·약어·장식 없음 |
| `report` | 개발 문서, 보고서, 인증 서류 | 현황과 문제 먼저, 한 문장 한 사실, 작업 과정 서술·과장 없음 |
| `plain` | 그 밖의 파일 | 짧은 문장, 기존 파일의 낱말을 따름 |

### /lanekeeper:decide

- 언제: 구조·문구·범위처럼 소유자가 정할 사항이 생겼을 때. 웨이브를 시작할 때 대기 중인 결정을 확인할 때.
- 어떻게: 질문, 선택지 2~4개, 추천과 이유로 `lanekeeper-decide new` 를 실행한다. 답을 받으면 `lanekeeper-decide answer` 로 기록한다. 커밋은 제안만 한다. 대기 목록은 `lanekeeper-decide list --pending` 이다.
- 예시:

```
lanekeeper-decide new list-search --title "목록 화면 검색 상자 위치" --question "검색 상자를 어디에 둘까요?" \
  --option "A=목록 위 전체 폭" --option "B=목록 오른쪽 위 작은 상자" --recommend A
lanekeeper-decide list --pending
결정 대기	2026-10-17-list-search.md	목록 화면 검색 상자 위치
```

### /lanekeeper:lanes

- 언제: 어떤 레인이 돌고 있는지 볼 때, 웨이브와 레인을 만들 때.
- 어떻게: `lanekeeper-waves board` 결과를 그대로 보여 준다. 토큰과 모델 합계는 `lanekeeper-waves metrics` 다. 「진행」인데 `*` 가 없고 경과 시간이 늘어나는 레인은 멈췄을 가능성이 높으므로 `/lanekeeper:resume` 을 권한다. 표 아래에 `lanekeeper-slot check` 의 부하 단계와 고아 프로세스 후보를 함께 보여 준다.
- 예시:

```
wave/lane  상태       모델  작업        실행/되돌림  할 일  통과/실패  토큰  경과
w1/l1      검수 대기  opus  impl-multi  1/0          0/2    0/0        0     0m
```

### /lanekeeper:pickup

- 언제: 새 세션을 시작해 이전 작업을 이어받을 때.
- 어떻게: `progress.md` 를 처음부터 끝까지 읽고 `lanekeeper-waves resume` 을 실행한다. 오래된 항목을 먼저 보고하고, 다음 할 일과 재개·검수할 레인을 알려 준다. 워크트리나 브랜치를 스스로 지우지 않는다. 세션을 마칠 때는 아카이브와 `progress.md` 를 갱신해 함께 커밋하고 `/clear` 를 안내한다.
- 예시: `/lanekeeper:pickup`

```
# 먼저 보고할 오래된 항목
  - progress.md 이 최근 작업보다 오래됐습니다. 새 작업 전에 갱신하십시오.
```

### /lanekeeper:resume

- 언제: 사용량 한도나 오류로 웨이브가 중단된 뒤, 진행판에 멈춘 레인이 보일 때.
- 어떻게: `lanekeeper-waves resume` 보고를 보여 주고 오래된 항목을 먼저 알린다. 「검수 대기」 레인은 검수하고, 「멈춤」「시작 안 함」「실패」「막힘」 레인은 `lanekeeper-waves resume --prompt <웨이브>/<레인>` 문구로 같은 워크트리에 다시 보낸다. 다시 보내기 전에 `lanekeeper-waves status <웨이브> <레인> pending` 으로 상태를 돌린다.
- 예시: `/lanekeeper:resume`

### /lanekeeper:review-lane

- 언제: 레인이 보고를 마쳤을 때, 진행판에 「검수 대기」 레인이 있을 때.
- 어떻게: 검수 모델을 `lanekeeper-route resolve review --implementer <레인 모델>` 로 정한다. 화면 변경이면 캡처를 직접 열어 본 뒤 `--captures-seen` 을 붙인다. `lanekeeper-check lane` 을 통합 워크트리에서 실행한다. 통과(종료 코드 0)면 원장이 「완료」가 되고, 실패(1)면 되돌림 지시서가 생긴다. 레인 코드를 직접 고쳐 통과시키지 않는다.
- 예시: [시작하기](01-getting-started.md) 4.6절.

### /lanekeeper:integrate

- 언제: 검수를 통과한 레인을 통합 브랜치에 합칠 때.
- 어떻게: 통합 워크트리가 깨끗하고 게이트가 돌고 있지 않은지 확인한다. 큰 레인은 `--dry-run` 으로 먼저 확인한다. 웨이브의 레인을 모두 합친 뒤 전체 검증을 한 번 돌리고, 영향받는 서버를 다시 띄우고, 끝난 레인 워크트리를 지운다. 코드 충돌을 통합 워크트리에서 손으로 풀지 않으며, 보호 브랜치에 병합하지 않고 push 하지 않는다.
- 예시:

```
lanekeeper-integrate lanekeeper/search/l1 --lane l1 --wave w1 --trailer "Co-Authored-By: Claude <noreply@anthropic.com>"
lanekeeper/search/l1 를 병합했습니다. 새 HEAD b572a921d734
```

### /lanekeeper:test-report

- 언제: 통합·최종 검증의 증거가 필요할 때, 시험 결과를 엑셀로 달라는 요청을 받았을 때.
- 어떻게: `lanekeeper-test-report env` 로 준비를 확인하고, 처음이면 `lanekeeper-test-report init` 으로 설정을 만든다. `lanekeeper-test-report run --name <이름>` 으로 돌리고 xlsx 와 json 을 커밋한 뒤 `lanekeeper-check test-results` 로 확인한다. 통과 결과를 얻으려고 시험을 약하게 바꾸지 않는다.
- 예시:

```
lanekeeper-test-report summary
시험 결과 docs/test-results/2026-10-17/integration-2238.xlsx · 판정 통과 · 커밋 425ace6
  unit: 총 2 · 통과 2 · 실패 0 · 건너뜀 0 · 간헐 0
  gate: 1단계 · 실패 0 · 미실행 0
```

### /lanekeeper:quality-unit

- 언제: 단위 시험을 돌리고 결과를 남겨야 할 때, 출하 검증 관문이 단위 결과를 없음·낡음·실패로 보일 때.
- 어떻게: 변경을 먼저 커밋한다. `lanekeeper-quality run --category unit` 을 실행한다. 출력의 `[quality] …` 줄 수치를 그대로 인용하고, 실패하면 원인을 고친 뒤 다시 돌린다. 결과 JSON·엑셀·색인을 커밋한다.
- 예시: `lanekeeper-quality run unit`

### /lanekeeper:quality-integration

- 언제: 시험용 DB 같은 실제 서비스를 쓰는 통합 시험 결과가 필요할 때.
- 어떻게: `lanekeeper-quality run --category integration`. 운영 DB 가 아니라 고정된 시험용 인스턴스를 가리키는지 설정을 먼저 확인한다.
- 예시: `lanekeeper-quality run pg`

### /lanekeeper:quality-gate

- 언제: 문서·코드 규칙·타입 검사 같은 게이트 단계의 결과를 남길 때.
- 어떻게: 게이트 스위트는 `steps` 로 단계를 나열한다. 앞 단계가 실패해도 모든 단계를 돌리고, 단계 하나가 시험 하나로 집계된다. 단계를 빼면 시험 수 감소로 잡힌다.
- 예시: `lanekeeper-quality run gate`

### /lanekeeper:quality-e2e

- 언제: 종단 시험 결과가 필요할 때.
- 어떻게: `lanekeeper-quality run --category e2e`. 슬롯 `heavy,browser` 로 헤드리스 실행한다. `playwright` 형식에서는 `test.fixme` 가 보류, 재시도 뒤 통과가 간헐로 집계된다. 케이스 원장 대조가 필요하면 `/lanekeeper:test-report` 도 함께 쓴다.
- 예시: `lanekeeper-quality run e2e`

### /lanekeeper:quality-uistab

- 언제: 화면 배치·넘침·시각 점검 하네스의 결과가 필요할 때.
- 어떻게: 하네스의 임계 파일을 스위트의 `thresholds` 에 적는다(`max` 는 숫자가 커지면 완화, `min` 은 작아지면 완화). 결과에 파일 해시가 남고, 관문이 완화를 막는다.
- 예시: `lanekeeper-quality run uistab`

### /lanekeeper:quality-usability

- 언제: 처음 쓰는 사용자 기준의 사용성 시험 결과가 필요할 때.
- 어떻게: 자동 부분은 스위트 명령으로 돌린다. 에이전트 부분은 시나리오마다 초보 사용자 대역 에이전트를 지시서와 함께 보내 목표 달성·단계 수·헤맨 곳·막힌 곳을 받는다. 목표를 달성하고, 막힌 곳이 없고, 단계 수가 예상의 1.5배 이내면 통과다. 모든 P0 시나리오가 통과하고 막힘이 없어야 전체 통과다. 결과는 `lanekeeper-quality record` 로 남긴다.
- 예시: `lanekeeper-quality record usability --verdict passed --from usability.json`
- 관계: 초보자가 주요 과제를 끝낼 수 있는지를 본다. 되는 여정 주변에서 틀린 데이터·길 잃음·흐름 끊김·모양 불일치를 찾는 것은 `/lanekeeper:quality-ux-adversarial` 이다. 둘 다 할 때는 이것을 먼저 한다.

### /lanekeeper:design-adversarial

- 언제: 설계 문서가 나와 구현에 들어가기 전, 설계를 판으로 고쳤을 때, 그 설계로 만든 구현이 끝났을 때.
- 어떻게: 설계를 쓴 쪽과 다른 맥락의 검증 에이전트 `lanekeeper:design-adversary`(권장 모델 Fable, 없으면 Opus, 읽기 전용)를 지시서와 함께 보낸다. 검증자는 설계 문장만 보지 않고 인용된 코드 지점을 직접 대조한다. 지적은 높음·중간·낮음으로 나누고 근거 `파일:줄` 과 고칠 방향을 붙이며, 마지막 줄에 「높음 N건」을 적는다. 설계는 2판·3판으로 고치고, 판마다 바뀐 문단에 판 표식과 반영 대조표(지적 → 수용·불수용 → 반영 위치, 불수용은 근거)를 둔 뒤 다시 검증한다. 높음만 고친 판은 해당 지적과 그 판의 새 위험만 짧게 재검증해도 된다. 「높음 0건」이어야 구현에 들어간다. 오너 결정이 필요한 항목은 따로 모아 `/lanekeeper:decide` 로 확인받는다. 화면 설계·시안은 UX 적대 점검의 아홉 축으로 본다. 구현이 끝나면 새 검증자가 코드를 정독해 설계 불변식이 지켜졌는지 확인한다.
- 예시: 검증 결과 `review-rev2.md` 의 마지막 줄 `high 0` → 구현 레인 디스패치

### /lanekeeper:quality-ux-adversarial

- 언제: 화면이 있는 제품을 출하하기 직전, 그 판에서 바뀐 화면을 게이트·DB 검증·e2e 와 함께 점검할 때(`/lanekeeper:ship-verify` 가 부른다). 출하 검증 관문이 `ux-adversarial` 경고를 냈을 때.
- 어떻게: 구현 세션과 분리된 점검 에이전트 `lanekeeper:ux-adversary`(권장 모델 Fable, 없으면 Opus)를 지시서와 함께 보낸다. 점검자는 제품 코드를 고치지 않는다. 먼저 페르소나(처음 쓰는 현업·관리자 등)를 정하고, 그 사람의 실제 과업 시나리오를 격리 스택에서 처음부터 끝까지 직접 수행한다. 화면마다 「이 사람이 지금 무엇을 이해했고 무엇을 하려 하는지」를 적는다. 헤드리스 브라우저(2x 캡처, Playwright 기본 인자 `--hide-scrollbars` 제외)로 여정과 경계 상황(밝음·어두움, 넓은·좁은 폭, 키보드만, 권한 없음, 빈 상태, 긴 이름, 많은 데이터, 저장 전 이탈, 뒤로가기·새로고침·딥링크)을 점검한다. 발견마다 다음을 남긴다. 사용자가 겪는 일 한 문장, 재현, 증거(지금 캡처, 실제 데이터 대조, computed style·픽셀 측정), 심각도(차단·높음·중간·낮음), 필수 아홉 축(①논리적 오류 ②정보 표기의 정합성 ③사용자 맥락 ④흐름 맥락 ⑤초보 기준 길 잃음 ⑥다음 할 일 인지 ⑦오류·예외에서 빠져나갈 길 ⑧접근성·좁은 폭·어두운 테마 ⑨디자인 시스템 시각 대조, 붙은 간격·좁은 줄간격·섞인 글자 크기와 굵기·표 행 높이·버튼과 배지 크기 등 린트 기준선이 못 잡는 시각 위반 포함), 디자인 시스템 기준 수정안, DOM/CSS 주입 시안 캡처. 다른 프런트엔드 구현이 있으면 파리티도 본다. 메인 세션은 지금·시안 캡처를 나란히 놓은 아티팩트로 오너에게 보고하고, 오너가 확인한 발견만 고친 뒤 새 점검자로 다시 점검한다. 해결하지 않은 차단·높음 발견이 있으면 판정은 실패이고 출하를 막는다. 화면을 바꾸는 지적은 모아서 오너 확인을 받은 뒤 고친다.
- 예시: `lanekeeper-quality record ux-adversarial --verdict failed --from counts.json`

### /lanekeeper:ship-verify

- 언제: 출하 여부를 판정할 때, 출하 검증 스킬이나 검증 에이전트가 관문 훅에 막혔을 때.
- 어떻게: 모두 커밋한 뒤 `lanekeeper-quality precheck --run` 을 실행한다. 실패한 종류는 원인을 레인에 맡겨 고치고(지시서 필수) 그 종류를 다시 돌린다. 통과할 때까지 반복한다. 약화는 되돌리거나 소유자 승인을 받는다. 관문을 통과하면 그 판에서 바뀐 화면을 `/lanekeeper:quality-ux-adversarial` 로 점검한다(차단·높음 지적이 남으면 멈춘다). 그다음 출하 판정(verifying-production-readiness)을 하고 `lanekeeper-quality record ship --verdict passed|failed --report <보고서>` 로 판정을 남긴 뒤 `/lanekeeper:quality-report` 로 취합한다.
- 예시:

```
lanekeeper-quality precheck --run
출하 검증 선행 관문 · HEAD 9df034edb
  unit         통과     2026-10-18 9df034edb 통과
  e2e          약화     2026-10-18 9df034edb 통과  — 건너뜀·보류 증가 2→5(기준 be05687d1)
막힘: 1개 항목이 통과하지 않았습니다. 출하 검증을 시작할 수 없습니다.
```

### /lanekeeper:quality-report

- 언제: 버전 품질 보고서가 필요할 때, 출하 검증을 마쳤을 때.
- 어떻게: `lanekeeper-quality report [--version <버전>]` 이 그 버전의 종류별 최신 결과로 `quality-<버전>.xlsx`(요약 + 종류별 시트 + 실행 이력)와 `.md`·`.html` 을 만든다. 고객용 문서로 옮길 때는 수치와 버전·날짜를 그대로 쓰고 내부 경로나 도구 이름은 쓰지 않는다.
- 예시: `lanekeeper-quality report --version 1.6.0`

### /lanekeeper:docs-sync

- 언제: 화면·기능을 고친 뒤 매뉴얼·문서·화면 문구·스크린샷을 맞출 때, `lanekeeper-docs check` 나 품질 종류 `docs` 가 실패했을 때.
- 어떻게: `lanekeeper-docs map` 으로 영향 지도를 보고, `lanekeeper-docs apply` 로 생성 문서를 다시 만들고, `lanekeeper-docs drafts` 의 초안대로 글을 고친다. 재촬영 후보는 지도에 나온 명령으로 다시 찍는다. 이때 전용 포트, 헤드리스, 2배 배율을 쓴다. `lanekeeper-docs verify` 로 검사하고 `lanekeeper-docs check` 가 통과할 때까지 되풀이한다. 일부러 옛 문구를 남기는 문서는 근거와 함께 `docs_sync.ack_file` 에 적는다.
- 예시: `lanekeeper-docs drafts --out drafts.md`

### /lanekeeper:report

- 언제: 웨이브가 취합·검증된 뒤, 끝난 작업을 다른 사람에게 보여 줘야 할 때.
- 어떻게: 시험 결과(`lanekeeper-check test-results --json`, `lanekeeper-test-report summary --json`), 결함 대장(`lanekeeper-defects summary --json`), 레인 원장(`lanekeeper-waves board --json`)을 모은다. 캡처를 `lanekeeper-art keep` 으로 보관하고, 본문을 Markdown 으로 쓰고, `lanekeeper-art report` 로 HTML 을 만들어 아티팩트로 게시한다. 보고는 「병합 준비 완료」에서 멈춘다. 「구현됨」과 「배포됨」을 구분해 적는다.
- 예시: [시작하기](01-getting-started.md) 4.8절.

### /lanekeeper:approve

- 언제: 보호 브랜치(`main` 등)에 병합·push·커밋해야 할 때, 시험 결과의 약화가 의도한 변경일 때, 자동 재개를 묻지 않고 실행하려 할 때, 멈춘 게이트가 잠금을 남겼을 때. 저장소 소유자만 입력한다.
- 어떻게: `/lanekeeper:approve merge-main|push-main|commit-main [브랜치나 커밋]` 또는 `/lanekeeper:approve merge-pr [PR 번호] [--repo 소유자/이름]` 을 프롬프트에 직접 입력한다. 허가는 기본 15분 동안 한 번, 입력할 때의 커밋에만 유효하다. 게이트 명령을 설정한 프로젝트는 같은 커밋의 게이트 통과 표식도 필요하다. 상태는 `/lanekeeper:approve status`, 취소는 `/lanekeeper:approve revoke` 다. 강제 push 는 허가가 있어도 막힌다.
- 그 밖의 결정: 아래 세 가지는 입력하는 즉시 적용되고, 유효한 허가는 그대로 둔다. `accept-quality <종류> --reason 사유` 는 그 종류의 최신 결과가 있는 커밋에 승인을 기록한다. 기록 위치는 결과 폴더의 `accepted.json` 이고, 이 파일은 나중에 커밋한다. `retry-bypass` 는 자동 재개가 `bypassPermissions` 를 쓰게 한다. 되돌리려면 `lanekeeper-retry mode default` 를 실행한다. `clear-gate-lock` 은 `machine.slots.stale_after_min` 보다 오래된 `gate.lock` 을 지운다.
- 첫 커밋: `refs/` 아래에 ref 가 하나도 없는 저장소의 주 체크아웃에서는 HEAD 가 가리키는 보호 브랜치에 `commit-main` 허가를 만들 수 있다. 저장소에 커밋이 생기면 이 허가는 거부된다. 고아 브랜치와 연결 워크트리는 거부한다.
- 목적지: `merge-main` · `push-main` 허가는 `--to <브랜치>` 로 정한 보호 브랜치에만 쓴다. 생략하면 지금 체크아웃한 보호 브랜치, 그것도 아니면 설정의 첫 보호 브랜치다. `push-main` 은 지정한 대상이 보호 브랜치면 그 브랜치다. `push-main` 허가는 원격 주소에도 묶인다. `--remote <이름>` 으로 정하고, 생략하면 그 브랜치의 기본 원격이다. 주소를 직접 쓴 push 는 허가의 주소와 같을 때만 통과한다. `git@host:path` 는 `ssh://host/~/path` 와 같고 `https://host/path` 와는 다르게 본다. `remote.<이름>.push` 가 줄이나 저장소에 있는 push 는 `:` 없는 refspec 의 목적지가 바뀌므로 거부하고, 이 설정의 쓰기는 확인 창으로 묻는다. `remote.<이름>.mirror` 가 참인 원격으로 가는 push 도 거부하고, 이 설정의 쓰기와 `git remote add --mirror` 는 확인 창으로 묻는다.
- 스테이지: `commit-main` 허가는 허가할 때 스테이지된 내용으로 만드는 새 커밋 1개에만 쓴다. 스테이지가 달라지거나, `git commit -a` · `git commit <경로>` · `--amend` · `cherry-pick` 이거나, 스테이지를 바꿀 수 있는 명령이 같은 줄에 있으면 거부한다.
- 한 줄에 반영 한 건: 한 줄에 보호 브랜치 반영이 2건 이상이거나 반복문 안에 있으면 거부한다. 함수로 두 번 호출하는 형태와 `--tags` · `--follow-tags` 를 붙인 push 도 2건으로 센다.
- 확인 창: 메인 세션의 에이전트가 `lanekeeper-grant merge-main|push-main|commit-main [브랜치나 커밋] [--to 브랜치] [--remote 원격]`, `lanekeeper-quality accept <종류> --reason "사유"`, `lanekeeper-reap --gate-lock` 중 하나를 한 줄 단독으로 실행하면, `default` · `acceptEdits` · `auto` 모드에서 창이 뜬다. 허용하면 실행되고 거절하면 아무것도 바뀌지 않는다. 다른 모드, `-p` · SDK, 서브에이전트, 묶거나 바꾼 명령, 이 명령을 덮는 허용 규칙은 거부되고 슬래시 명령을 안내한다. 보호 브랜치 허가 3종은 `auto` 에서도 거부한다. `retry-bypass` 에는 창이 없다.
- PR 병합: `gh pr merge` 가 막히면 메인 세션에서 `lanekeeper-grant merge-pr <번호> --repo <소유자/이름>` 으로 창을 띄운다. 허용한 뒤 같은 병합 명령을 다시 실행한다. 소유자가 직접 입력할 때는 `/lanekeeper:approve merge-pr <번호> --repo <소유자/이름>` 이다. 허가는 저장소 · PR · 머리 커밋 · 대상 브랜치에 묶이고, `~/.lanekeeper/owner/` 에 저장되어 세션 폴더와 상관없이 동작한다. `merge-main` 허가는 `--repo` · `GH_REPO` · `GH_HOST` 를 적은 병합에 쓰이지 않는다.
- 기록: 실행된 결정은 `<git 공용 폴더>/lanekeeper/owner-decisions.jsonl` 에 `via`(`dialog` · `slash`)와 함께 남는다. 거절된 창은 기록되지 않는다.
- 예시: `/lanekeeper:approve merge-main lanekeeper/search/int`

### /lanekeeper:auto-retry

- 언제: 한도 뒤 자동 재개 상태를 보거나 켜고 끌 때, 예약된 재개를 취소할 때.
- 어떻게: `lanekeeper-retry status`, `lanekeeper-retry on|off`, `lanekeeper-retry cancel <세션 앞부분|all>`, `lanekeeper-retry mode <모드>`, `lanekeeper-retry limits` 를 실행한다. Claude 는 `bypassPermissions` 를 켤 수 없다. `lanekeeper-retry mode bypassPermissions` 는 경고만 출력하고, 켜려면 사람이 `/lanekeeper:approve retry-bypass` 를 입력한다.
- 예시:

```
lanekeeper-retry status
자동 재개: 켜짐
재개 권한 모드: default
대기 중인 재개: 0건
```

### /lanekeeper:token-guard

- 언제: 사용량이 얼마나 남았는지 볼 때, 토큰 가드를 켜고 끌 때, 앱에서 본 사용량으로 보정할 때.
- 어떻게: `lanekeeper-token status` 가 공식 값(조회 시각·최신 여부·계정 끝 8자리·리셋 시각), 지금 추정과 증가분, 보정 계수의 근거를 보여 준다. 보정은 자동이 기본이다. 앱의 `/usage` 값을 직접 넣을 때는 `lanekeeper-token calibrate --five <n> --seven <n> [--at HH:MM]`, 쌓인 보정점 비교는 `lanekeeper-token calibrate --check` 를 쓴다. `lanekeeper-token calibrate [<가중 토큰>]` 은 공식 값이 없을 때 쓰는 대체 예산을 정한다. 켜고 끄기는 `lanekeeper-token on|off` 다.
- 예시: `/lanekeeper:token-guard calibrate --five 60 --seven 67`

### /lanekeeper:terse

- 언제: 출력과 도구 호출을 줄여 토큰을 아끼고 싶을 때.
- 어떻게: `lanekeeper-terse on|off|status`. 스위치는 저장소 단위이며 `/clear` 와 새 세션에도 유지된다. 켜는 즉시 Claude 가 `rules/terse.ko.md` 를 읽고 따른다. 모든 저장소에서 켜려면 `~/.lanekeeper/personal.json` 에 `"terse": true` 를 둔다. 검증 근거와 최종 보고는 줄이지 않는다.
- 예시:

```
lanekeeper-terse status
간결 모드: 꺼짐 (출처: default)
```
