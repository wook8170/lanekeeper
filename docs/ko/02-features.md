# 기능 안내

wb 의 기능은 세 가지 방식으로 동작한다. 훅은 Claude Code 가 도구를 실행하기 전후에 자동으로 판정한다. `wb-*` 명령은 사람이나 Claude 가 직접 실행한다. 스킬(`/wb:<이름>`)은 Claude 에게 정해진 순서로 명령을 실행하게 하는 작업 안내다.

이 문서는 기능별로 언제 쓰는지와 어떻게 쓰는지를 설명하고, 끝에 스킬 17개를 하나씩 정리했다. 설정 키의 기본값과 뜻은 [설정](03-configuration.md), 규칙별 이유와 복구 방법은 [규칙 안내](04-rules.md)에 있다.

## 1. 기능 한눈에 보기

| 기능 | 동작 방식 | 관련 명령·스킬 |
|---|---|---|
| 모델 라우팅·디스패치 검사 | 서브에이전트를 보낼 때 훅이 모델과 지시서를 검사 | `wb-route`, `wb-check brief` |
| 안전 훅 | git·프로세스 종료·삭제·브라우저·경로 쓰기를 실행 전에 판정 | `/wb:approve` |
| 실행 슬롯·포트·레인 워크트리 | 무거운 실행 수 제한, 레인별 포트, 레인 작업 폴더 | `wb-slot`, `wb-port`, `wb-worktree`, `wb-reap` |
| 레인 원장·진행판·재개 | 웨이브와 레인 상태 기록, 중단된 레인 재개 | `wb-waves`, `/wb:lanes`, `/wb:resume`, `/wb:pickup` |
| 진행 기록 | `progress.md` 를 현재 상태로 유지, 끝난 내용은 아카이브 | `wb-waves handoff` |
| 시험 결과 엑셀·케이스 원장 | 통합 검증 결과를 xlsx 로 저장, 시험 케이스와 결함 관리 | `wb-test-report`, `wb-cases`, `wb-defects`, `/wb:test-report` |
| 검수·취합·보고 | 9항목 검수, 규칙 기반 병합, 아티팩트 보고 | `wb-check lane`, `wb-integrate`, `wb-art`, `/wb:review-lane`, `/wb:integrate`, `/wb:report` |
| 시안 먼저 | 화면 구조 변경을 결정 기록 전에 막음 | `wb-decide`, `/wb:decide` |
| 초보자 계층 | 한 줄 요청 안내, 막힌 이유 설명, 문체 지정 | `/wb:work`, `/wb:explain`, `/wb:writing-style` |
| 코드 색인 | codegraph 색인 대기열, 사용 안내 | `wb-index` |
| 세션 보조 | 토큰 가드, 자동 재개, 간결 모드, 체크포인트 | `wb-token`, `wb-retry`, `wb-terse`, `/wb:token-guard`, `/wb:auto-retry`, `/wb:terse` |
| 설정 점검 | 설정 오류와 값의 출처 확인 | `wb-config`, `/wb:init`, `/wb:doctor` |

## 2. 모델 라우팅과 디스패치 검사

작업 종류마다 쓸 모델의 순서(대체 순서)와 최소 등급이 `routing.json` 에 있다. 대체 순서에서 금지 모델과 사용 한도에 걸린 모델을 빼고, 남은 첫 모델이 최소 등급 이상이면 그 모델을 쓴다. 최소 등급 아래만 남으면 작업을 보내지 않고 리셋 시각까지 기다린다.

기본 작업 종류는 10가지다.

| 작업 종류 | 용도 | 대체 순서 | 최소 등급 |
|---|---|---|---|
| `design` | 설계·분석·계획 | fable → opus | opus |
| `review` | 검수·판정 | fable → opus | opus |
| `security` | 보안 검토 | opus | opus |
| `adversarial` | 반대 입장 검토. 구현 모델은 뺀다 | opus → fable | opus |
| `impl-multi` | 여러 파일 구현 | opus → sonnet | sonnet |
| `impl-spec` | 명세가 확정된 구현 | sonnet → opus | sonnet |
| `mockup` | 시안 | opus → sonnet | sonnet |
| `defect-history` | 결함 이력 분석 | sonnet → opus | sonnet |
| `mechanical` | 기계적 편집 | haiku → sonnet | haiku |
| `research` | 읽기 전용 조사 | haiku → sonnet | haiku |

결과를 미리 보는 명령은 다음과 같다.

```
wb-route tasks                                  작업 종류별 대체 순서와 최소 등급
wb-route resolve impl-multi                     쓸 모델. 대기면 종료 코드 3
wb-route explain review --implementer opus      단계별 판정 과정
wb-route check review --model sonnet            모델 선택 판정. 차단이면 종료 코드 1
```

```
작업 종류 review · 사슬 fable > opus · 바닥선 opus
  1 금지: -
  2 한도 소진: -
  3 구현 모델 제외: -
  4 바닥선 미만: -
결과: fable (model: "fable")
```

**디스패치 검사.** Claude 가 Agent 도구로 서브에이전트를 보낼 때 훅이 다음을 확인한다. 지시서 첫 줄 표지(`<!-- wb-brief v1 type=<작업 종류> lane=<레인> template=<틀> -->`), 필수 절(목표·범위·금지·시험 규칙·보고 위치·커밋 규칙), 채우지 않은 `{{…}}` 자리, `model` 지정, 금지·한도 소진 모델, 최소 등급, 동시 레인 수다. 하나라도 어긋나면 막고 라우팅 결과를 알려 준다. `fork`·`claude-code-guide`·`statusline-setup` 에이전트는 지시서 검사를 건너뛴다(`project.dispatch.exempt_agents`).

**지시서 틀.** `templates/briefs/ko`, `templates/briefs/en` 에 7종(impl·fix·mockup·research·review·docs·test)이 있다. `wb-style brief <틀> --owned <파일,…> --var 이름=값` 으로 채우고 `wb-check brief <파일>` 로 점검한다.

## 3. 안전 훅

Bash·Write·Edit·MultiEdit·NotebookEdit·Skill 호출을 실행 전에 판정한다. 결과는 허용, 확인 요청, 차단 중 하나다. 훅 입력에 서브에이전트 표시가 있거나 대상 워크트리가 레인 대장에 있으면 레인으로, 그 밖은 메인 세션으로 본다.

| 대상 | 주요 판정 |
|---|---|
| git | 레인은 자기 브랜치에만 커밋한다. push·병합·브랜치 이동은 레인에게 막힌다. 보호 브랜치 커밋·병합·push 는 소유자 허가가 있어야 한다. 강제 push 는 누구도 못 한다. `reset --hard`·`clean -f`·`branch -D`·이름 없는 stash 는 확인 요청이다 |
| 프로세스 종료 | `pkill`·`killall` 처럼 이름으로 끄는 명령은 막는다. `kill <PID>` 는 대상이 보호 포트를 쓰면 막는다 |
| 삭제 | 홈·시스템 폴더·프로젝트 루트·`.git` 를 지우는 `rm -r` 는 막는다. 프로젝트 밖은 확인 요청이다 |
| 브라우저 | 창이 뜨는 Chrome, `--headed`, `playwright codegen`, 브라우저로 여는 `open` 은 막는다 |
| 경로 | `project.protected_paths` 와 wb 상태 파일 쓰기는 막는다. wb 설정 파일 수정은 확인 요청이다 |

명령은 `;` `&&` `|`, 서브셸, `sh -c`, `eval`, 별칭, `git -C`, `cd` 를 풀어서 판정한다. 대상을 실행 전에 알 수 없는 명령(명령 이름이 변수인 경우 등)은 막는다. 설정 파일에 오류가 있으면 위험한 명령은 모두 막는다.

예시(메인 세션, 통합 브랜치에서 실행):

```
$ pkill -f vite
[wb] 막았습니다: 이름·패턴으로 프로세스를 끄면(`pkill`) 다른 세션이나 소유자의 서버까지 꺼질 수 있습니다.
이렇게 고치세요: 자기가 띄운 프로세스의 PID 를 확인해 `kill <PID>` 로 끄세요.
물어볼 곳: `/wb:doctor` 를 실행하거나 README 의 「안전 훅」 절을 보세요. 규칙을 바꿀 수 있는 사람은 저장소 소유자입니다.

$ git push origin wb/search/int
[wb] 확인이 필요합니다: 기능 브랜치 push 는 확인 후 진행합니다(설정 `project.git.feature_push: ask`).

$ git reset --hard HEAD~1
[wb] 확인이 필요합니다: `git reset --hard` 는 커밋하지 않은 변경을 되돌릴 수 없게 지웁니다(현재 `wb/search/int`).
```

**소유자 허가.** 보호 브랜치 반영은 소유자가 프롬프트에 `/wb:approve merge-main`(또는 `push-main`, `commit-main`)을 직접 입력할 때만 허가된다. 허가는 15분 동안 한 번, 입력한 시점의 커밋에만 유효하다. Claude 는 이 스킬을 부를 수 없고 허가 파일을 쓸 수도 없다.

**검사 범위 밖.** 안전 훅은 명령 문자열을 판정한다. 스크립트 파일 안의 명령이나 python·node 로 실행하는 git 호출은 판정하지 않는다.

## 4. 실행 슬롯·포트·레인 워크트리

**실행 슬롯.** 전체 시험·빌드·설치·e2e·색인 같은 무거운 실행과 헤드리스 브라우저는 머신 전체에서 개수를 센다. 기본값은 무거운 실행 2개, 브라우저 2개다. 빈 슬롯이 없거나 1분 부하가 문턱(기본 논리 코어 수 × 2) 이상이면 기다린다.

```
wb-slot --kind heavy -- pnpm -r test
wb-slot --kind heavy,browser -- npx playwright test
wb-slot status
wb-slot reap
```

```
1분 부하 3.79 / 문턱 20
heavy: 0/2 사용 중
browser: 0/2 사용 중
```

Claude 가 무거운 명령을 슬롯 없이 실행하면 기본(`machine.slots.guard: warn`)은 실행을 두고 감싼 명령을 알려 준다. `deny` 로 바꾸면 실행을 막는다. 파일 하나만 돌리는 시험(`vitest run a.test.ts`)은 무거운 실행으로 보지 않는다.

```
[wb] `npx playwright test` 은(는) 무거운 실행이라 슬롯(browser,heavy) 안에서 돌려야 합니다. 다음처럼 감싸서 다시 실행하세요: `wb-slot --kind browser,heavy -- sh -c 'npx playwright test'`
```

**포트.** 보호 포트와 레인 포트 대역의 숫자는 머신 설정(`~/.wb/machine.json`)에만 둔다. 문서와 지시서는 이름만 쓰고 `wb-port get <이름> [--lane <레인>]` 으로 숫자를 얻는다. 레인 대역은 41000 부터 레인마다 20칸이며, 이름별 포트(web·web2·api·db·aux)를 빌려 준다.

```
wb-port list
```

```
보호 포트 0개
레인 대역: 시작 41000, 간격 20, 이름 web,web2,api,db,aux, 최대 9레인
임대 0건
```

**레인 워크트리.** `wb-worktree create <레인>` 은 통합 브랜치 HEAD 에서 레인 브랜치와 작업 폴더를 만들고, 포트를 빌리고, 레인 대장에 등록한다. `.worktreeinclude` 에 적힌 git 무시 파일(예: `.env`)을 복사하고, `project.worktree.setup` 에 적은 설치 명령을 슬롯 안에서 실행한다. 살아 있는 레인이 상한(기본 3)에 닿으면 만들지 않는다.

```
wb-worktree create l1
wb-worktree list
wb-worktree remove l1 [--force] [--delete-branch]
```

지울 때 그 폴더 안에서 도는 프로세스가 있으면 지우지 않고 PID 목록을 보여 준다. 하나씩 `kill <PID>` 로 끈 뒤 다시 실행한다.

**Claude Code 워크트리 훅(선택).** `/wb:init` 에서 예라고 답하거나 `project.worktree.hook` 을 `true` 로 두면, Claude Code 가 워크트리를 만들 때(`claude --worktree`, 서브에이전트 `isolation: "worktree"` 등) wb 의 방식을 쓴다. 이 훅은 이 머신의 `.claude/settings.local.json` 에 등록되며 Claude Code 의 기본 워크트리 생성을 통째로 대체한다. 상태는 `wb-worktree hooks status`, 즉시 반영은 `wb-worktree hooks sync` 로 한다.

**정리.** `wb-reap` 은 끝난 슬롯 임대를 회수하고, 폴더가 없어진 레인의 포트 임대와 대장 항목을 보여 준다. `--apply` 를 주면 정리한다. 프로세스는 끄지 않는다.

## 5. 레인 원장·진행판·재개

웨이브와 레인의 상태는 `<git 공용 폴더>/wb/waves.json` 에 기록하며, 모든 워크트리가 같은 파일을 본다. 기록은 `wb-waves` 로만 한다. JSON 을 직접 고치지 않는다.

```
wb-waves init-wave w1 --title "목록 검색 상자"
wb-waves lane w1 l1 --task impl-multi --model opus --brief .wb/briefs/l1.md --todo "검색 상자 추가"
wb-waves board
wb-waves metrics
```

디스패치 검사를 통과한 호출, 서브에이전트 시작, 서브에이전트 종료를 훅이 원장에 자동으로 반영한다. 지시서 표지의 `lane=` 값으로 레인을 찾는다. 레인이 끝나면 상태가 「검수 대기」가 되고, 검수에서 되돌리면 되돌림 횟수가 1 늘어난다.

레인 상태는 대기·진행·검수 대기·막힘·실패·완료 여섯 가지다. 진행판의 `*` 는 에이전트가 지금 돌고 있다는 뜻이다. 플러그인은 서브에이전트 상태줄에 `wb 1/3 실행 · l1:진행` 같은 한 줄을 보여 준다.

**재개.** 세션이 끊기거나 한도에 걸린 뒤에는 `/wb:resume` 이 `wb-waves resume` 보고를 만든다. `progress.md`, git 상태, 워크트리 목록, 최근 커밋, 레인 판정, 오래된 항목을 한 번에 보여 준다. 멈춘 레인은 `wb-waves resume --prompt w1/l1` 이 만든 문구로 같은 워크트리에 다시 보낸다.

## 6. 진행 기록(progress.md)과 아카이브

`progress.md` 는 지금 유효한 상태만 담는다. 기준은 300줄 이하다. 맨 위에 아카이브 위치와 검색 방법 한 줄을 두고, 목표와 오너 결정 · 브랜치와 서버 · 진행 중(표) · 다음 할 일 · 확인 대기 · 시스템 지식 · 재개 명령 절을 쓴다.

| 시점 | 훅이 하는 일 |
|---|---|
| 세션 시작·`/clear` | `progress.md` 전체와 아카이브 검색 방법을 대화에 넣는다 |
| 턴 종료 | 마지막 갱신 뒤에 커밋이나 파일 변경이 있으면 한 번 막고 인계를 요구한다. 같은 세션은 20분 동안 다시 막지 않는다 |
| 기준 줄 수 초과 | 세션 시작·종료·재개 보고에서 알리고 `wb-waves handoff migrate` 를 안내한다 |

끝난 내용(완료한 웨이브, 해소된 확인 대기)은 `docs/progress-archive/progress-<YYYY-MM>.md` 끝에 날짜 절로 덧붙인다. 이력은 지우지 않으며 필요한 부분은 `grep -n '<키워드>' docs/progress-archive/*.md` 로 찾는다.

```
wb-waves handoff check                      줄 수와 아카이브 목록. 기준 초과면 종료 코드 1
wb-waves handoff archive "<요지>"           지금 progress.md 전체를 이번 달 아카이브 끝에 덧붙임
wb-waves handoff migrate                    기준을 넘은 누적형 파일을 아카이브로 옮기고 새 양식으로 만듦
```

`progress.md` 가 없는 저장소에서는 인계 훅이 동작하지 않는다. 처음 한 번은 직접 만든다.

## 7. 시험 결과 엑셀과 케이스 원장

통합·최종 검증 결과를 엑셀(xlsx)과 요약 json 으로 남긴다. Python 3.8 이상과 openpyxl 이 필요하다. 없으면 설치 명령을 안내하고 엑셀만 건너뛴다. 엑셀은 게이트 통과의 조건이 아니다. 엑셀을 만들지 못해도 게이트와 모든 단계가 통과하면 게이트 통과 표식을 남기고, 엑셀 경고는 한 줄 안내로만 나온다.

```
wb-test-report env                          준비 확인
wb-test-report init                         .wb/verify.config.json 생성
wb-test-report run --name integration       게이트 → 단계별 시험 → 엑셀(전체 통과면 게이트 통과 표식)
wb-test-report gate-pass                    project.gate.command 실행, 통과하면 게이트 통과 표식
wb-test-report summary [--json]             최신 결과 수치
wb-check test-results                       최신 결과가 있고 커밋됐는지 확인
```

단계(`stages`)마다 결과 형식(`adapter`: vitest · jest · playwright · pytest), 종류(`kind`: unit · integration · e2e · uistab), 명령(`cmd`, `{file}` 에 결과 파일이 놓인다), 슬롯(`slot`: heavy · `heavy,browser` · none)을 적는다. 앞 단계가 실패해도 모든 단계를 돌린다. 실행 중에는 게이트 잠금(`<git 공용 폴더>/wb/gate.lock`)을 잡아 병합을 기다리게 한다.

엑셀 시트는 요약 · 단위 · 통합 DB · e2e · e2e 상세 · UI 안정성 · gate 단계 · 실패 목록 · 간헐 실패 · 원장 대조 · 커버리지 · 변이다. 결과가 없는 시트는 만들지 않는다. 시트 이름·머리글·요약 문구는 `personal.language` 설정을 따른다(`ko` 는 위 이름, `en` 은 Summary · Unit · Integration DB · e2e · e2e detail · UI stability · Gate steps · Failures · Flaky · Ledger comparison · Coverage · Mutation). 저장 위치는 `docs/test-results/<날짜>/<이름>-<HHMM>.xlsx` 이며 커밋한다.

**케이스 원장과 결함 대장.** `docs/e2e/<모듈>.cases.json` 과 `defect-register.json` 을 `wb-cases`, `wb-defects` 로 관리한다. 케이스 ID 는 다시 쓰지 않는다. 고칠 수 없는 결함은 시험을 약하게 바꾸지 않고 결함으로 등록한 뒤 케이스를 보류(`fixme`)로 둔다.

```
wb-cases init search --prefix SRCH
wb-cases add search --title "검색어 입력" --expected "일치 항목만 보임" --priority P1
wb-defects add --title "빈 검색어에서 목록이 사라짐" --severity high --case SRCH-001
wb-cases set search SRCH-001 --status fixme --defect D-001
wb-cases check
```

원장이 있으면 엑셀의 「원장 대조」 시트가 원장과 실행 결과의 불일치를 적는다. 불일치가 0 이어야 출하 판정을 한다.

## 8. 검수·취합·보고

레인이 끝나면 메인 세션은 검수 → 취합 → 보고 순서로 진행한다. 판정은 명령이 하고, 사람은 되돌림을 보낼지와 병합 준비를 마칠지만 정한다.

**검수(`wb-check lane`).** 레인 보고 파일을 정본으로 읽고 반환 메시지와 대조한다.

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

실패 항목이 있으면 `.wb/briefs/<레인>-return-<번호>.md` 에 되돌림 지시서를 만든다.

**취합(`wb-integrate`).** 통합 브랜치를 체크아웃한 폴더에서 레인 브랜치를 하나씩 시험 병합하고 충돌을 분류한다.

| 분류 | 처리 |
|---|---|
| 원장(`*.cases.json`, `defect-register.json`) | `id` 기준 합집합. 같은 id 는 통합 쪽 우선 |
| 등록 파일(`hooks/hooks.json`) | 객체 병합, 목록 합집합 |
| 생성물(`*.xlsx`, 잠금 파일) | 통합 쪽을 받은 뒤 `project.integrate.regenerate` 명령으로 다시 만듦 |
| 코드(그 밖의 파일) | 병합을 중단하고, 레인에 통합 최신을 병합해 오라는 되돌림 지시서를 만듦 |

종료 코드는 0 병합 완료, 1 중단(되돌림 지시서 생성), 2 시작하지 않음(작업 트리가 깨끗하지 않음 등), 3 게이트 실행 중이다.

**보고(`wb-art`).** 다시 볼 캡처는 `wb-art keep` 으로 `docs/reports/artifacts/<주제>/` 에 두고 커밋한다. 일회성 캡처는 `wb-art temp` 로 스크래치에 둔다. `wb-art report` 는 이미지를 data URI 로 넣은 HTML 한 파일을 만든다. 300KB 를 넘는 PNG 는 WebP 로 줄인다.

```
wb-art env
변환 도구: cwebp. 300KB 넘는 PNG 를 품질 80 WebP 로 바꿉니다
```

`/wb:report` 를 실행한 세션이 아티팩트 없이 끝나려 하면 Stop 훅이 한 번 막는다.

## 9. 시안 먼저

화면 파일 범위(`project.mockup.ui_globs`)를 정하면, 그 범위의 화면 구조를 바꾸는 쓰기를 결정 기록 전에 막는다. 범위가 비어 있으면(기본) 동작하지 않는다.

- 구조 변경으로 보는 것: 새 화면 파일, 마크업 요소 구성이 바뀌는 수정, 스타일 시트의 선택자 추가·삭제
- 통과하는 것: 문구, 속성, CSS 속성 값만 바꾸는 수정
- 막힘이 풀리는 조건: `docs/decisions/` 에 `status=decided kind=mockup` 이고 `scope` 가 그 파일을 덮는 결정 문서가 있음

순서는 현재 화면과 대안 시안을 아티팩트로 보여 주고, `wb-decide new … --kind mockup --scope …` 로 질문을 만들고, 선택을 `wb-decide answer` 로 기록한 뒤 커밋하는 것이다. 끄려면 `project.mockup.decision_required` 를 `false` 로 둔다.

## 10. 초보자 계층

레인 흐름을 모르는 사용자가 한 줄 요청으로 시작하고, 막혔을 때 이유를 바로 읽을 수 있게 하는 기능이다.

- `/wb:work` 는 요청을 종류(고장·기능·화면·문서·조사·큰 설계)로 나누고, 단계와 단계별 모델을 보여 준다. 진행 위치는 `wb-work progress` 가 일곱 단계 막대(`[■■■□□□□] 3/7 구현 중 · 진행 1`)로 보여 준다.
- `/wb:explain` 은 지금 막힌 것과 기다리는 것을 쉬운 말로 설명한다. 차단 메시지의 코드는 `wb-explain code <코드>` 로 규칙과 연결된다.
- `/wb:writing-style` 은 파일별 문체(해요체·보고서체·기본)를 정한다. `project.style.map` 의 첫 번째로 맞는 항목이 이긴다.
- `/wb:decide` 는 소유자가 정할 사항을 고정 선택지 질문으로 만들고 답을 `docs/decisions/` 에 남긴다.

```
wb-explain
지금 막힌 것도, 기다리는 것도 없어요.
```

## 11. 코드 색인(codegraph)

codegraph 는 선택 도구다. 설치돼 있지 않으면 관련 훅과 명령은 아무것도 하지 않고, `wb-index` 는 설치 방법만 알려 준다. 설치는 `/wb:init` 에서 사용자 동의를 받은 뒤에만 한다.

- 새 워크트리를 만들면 색인을 대기열에 넣는다. 같은 저장소의 다른 워크트리에 색인이 있으면 복사한 뒤 바뀐 파일만 다시 읽는다.
- 색인 작업은 한 번에 하나씩, 낮은 우선순위로, 무거운 실행 슬롯 안에서 돈다.
- 색인이 있는 체크아웃에서 식별자 하나를 grep 하면 세션에 한 번 codegraph 사용을 안내한다. grep 은 막지 않는다.
- 「색인 없음」 응답을 받은 경로로 codegraph 를 다시 부르면 막고 grep 으로 진행하라고 안내한다.

```
wb-index add .          지금 체크아웃을 대기열에 넣음
wb-index status         대기열과 최근 결과
wb-index orphans        워크트리가 아닌 폴더에 남은 색인
```

자동 등록을 모두 끄려면 `project.codegraph.auto_index` 를 `false` 로, 안내를 끄려면 `project.codegraph.nudge` 를 `off` 로 둔다. 환경 변수 `WB_CODEGRAPH=off` 는 이 기능 전체를 끈다.

## 12. 토큰 가드·자동 재개·간결 모드·체크포인트

| 기능 | 하는 일 | 관리 |
|---|---|---|
| 토큰 가드 | 최근 5시간 로컬 토큰 사용량을 예산에 대한 비율로 환산한다. 90% 는 작업 단위 축소, 95% 는 웨이브마다 인계, 99% 는 마지막 인계와 알림 후 대기를 지시한다 | `wb-token`, `/wb:token-guard` |
| 자동 재개 | 사용량 한도로 턴이 끝나면 리셋 시각 2분 뒤에 같은 세션을 헤드리스로 재개한다. 예약은 macOS launchd, Linux systemd 사용자 타이머, 그 밖에는 백그라운드 대기 프로세스로 한다 | `wb-retry`, `/wb:auto-retry` |
| 간결 모드 | 켠 저장소에서 세션 시작 때 출력과 도구 호출을 줄이는 규칙을 넣는다 | `wb-terse`, `/wb:terse` |
| 체크포인트 | 한도, 서브에이전트 종료, 대화 압축 시점에 레인 브랜치의 추적 파일 변경을 `wip(wb)` 커밋으로 남긴다. 비밀 파일 패턴과 추적되지 않은 파일은 커밋하지 않는다 | `personal.checkpoint.enabled` |

토큰 가드의 예산은 기본이 0(미보정)이며 이 상태에서는 동작하지 않는다. 앱에서 한도에 도달했을 때 `wb-token calibrate` 를 실행하면 그 시점의 사용량이 예산으로 기록된다. 집계 대상은 이 기기의 Claude Code 사용뿐이고 비율은 추정치다.

```
wb-token status
토큰 가드: 켜짐
최근 5시간(로컬 기록, 이 기기만): 출력 …, 입력 …, 캐시 읽기 …, 캐시 쓰기 … (응답 …건). 가중 합계 … (= 입력 + 1.25 캐시 쓰기 + 0.1 캐시 읽기 + 5 출력).
예산이 설정되지 않았습니다(personal.token_guard.budget = 0). 가드는 동작하지 않습니다. …
```

자동 재개의 권한 모드 기본값은 `default` 다. 이 모드에서는 승인이 필요한 도구가 무인 실행에서 거절되므로 재개한 작업이 그 지점에서 멈출 수 있다. `bypassPermissions` 는 `wb-retry mode bypassPermissions --i-understand` 로 위험을 확인한 뒤에만 켜진다.

## 13. 스킬 17개

스킬은 Claude Code 프롬프트에 `/wb:<이름>` 으로 입력한다. 설명에 맞는 요청을 하면 Claude 가 스스로 부르기도 한다. 단 `/wb:approve` 는 사람이 직접 입력할 때만 동작한다.

| 스킬 | 한 줄 설명 |
|---|---|
| `/wb:init` | 프로젝트에 wb 설정을 만든다 |
| `/wb:doctor` | 설정 오류, 값의 출처, git·Node.js·codegraph 상태를 점검한다 |
| `/wb:work` | 한 줄 요청을 레인 흐름으로 바꾸고 끝까지 안내한다 |
| `/wb:explain` | 막힌 것과 기다리는 것을 쉬운 말로 설명한다 |
| `/wb:writing-style` | 파일별 문체를 정하고 규칙을 보여 준다 |
| `/wb:decide` | 소유자 결정을 질문으로 만들고 답을 문서로 남긴다 |
| `/wb:lanes` | 웨이브·레인 진행판을 보여 주고 기록한다 |
| `/wb:pickup` | 세션 시작 때 이전 작업을 이어받는다 |
| `/wb:resume` | 중단된 웨이브를 재개한다 |
| `/wb:review-lane` | 레인 결과를 9항목으로 검수한다 |
| `/wb:integrate` | 검수를 통과한 레인을 통합 브랜치에 합친다 |
| `/wb:test-report` | 검증을 돌리고 결과를 엑셀로 남긴다 |
| `/wb:report` | 최종 보고를 아티팩트로 게시한다 |
| `/wb:approve` | 보호 브랜치 반영을 한 번 허가한다(사람만 입력) |
| `/wb:auto-retry` | 한도 뒤 자동 재개를 관리한다 |
| `/wb:token-guard` | 토큰 가드를 확인·보정한다 |
| `/wb:terse` | 간결 모드를 켜고 끈다 |

### /wb:init

- 언제: 저장소에서 wb 를 처음 쓸 때.
- 어떻게: 네 가지 질문(프로젝트 종류, 메시지 언어, 전체 검증 명령, Claude Code 워크트리 관리 여부)에 답한다. Claude 가 `wb-config init` 을 실행하고 `wb-config doctor` 로 결과를 보여 준다. 기존 파일은 덮어쓰지 않으며 커밋하지 않는다.
- 예시: `/wb:init` → 「web-ui, ko, npm test, no」라고 답한다. 자세한 출력은 [시작하기](01-getting-started.md) 3절.

### /wb:doctor

- 언제: 설치 직후, wb 가 예상과 다르게 동작할 때, 웨이브를 시작하기 전.
- 어떻게: `wb-config doctor` 결과를 보여 주고 `✗` 줄마다 원인과 고칠 방법을 설명한다. 특정 값의 출처는 `wb-config explain <키>` 로 확인한다. 시험 결과 엑셀 환경은 `wb-test-report env` 로 확인한다. 이 스킬은 아무것도 설치하지 않는다.
- 예시: 「machine.lanes.max 가 왜 3 이야?」

```
wb-config explain machine.lanes.max
machine.lanes.max
  값: 3
  합치는 규칙: 기본값을 뺀 층 중 가장 작은 값
  적용된 층: 기본값
  값을 둔 층:
    - 기본값 (…/defaults/machine.json): 3
```

### /wb:work

- 언제: 레인 흐름을 모르는 상태에서 일을 한 문장으로 맡길 때.
- 어떻게: Claude 가 요청을 다시 정리해 확인받고, `wb-work plan` 으로 종류와 단계를 정한다. 레인 워크트리, 지시서, 디스패치, 검수, 취합, 보고, 인계까지 단계마다 한 줄로 알려 준다. 진행 위치는 `wb-work progress` 로 본다. 보호 브랜치 병합과 push 는 하지 않는다.
- 예시: `/wb:work 목록 화면에 검색 상자 추가`

| 요청 종류 | 흐름 |
|---|---|
| 고장 | 재현(조사 레인) → 수정과 회귀 시험 → 다른 모델 검수 → 취합 → 보고 |
| 기능 | 지시서 → 구현 → 검수 → 취합 → 보고 |
| 화면 | 시안(현재와 제안) → 소유자 결정 → 구현 → 검수 → 취합 → 보고 |
| 문서 | 지시서 → 문체 규칙대로 작성 → 검수 → 보고 |
| 조사 | 찾아서 보고. 파일은 바꾸지 않는다 |
| 큰 설계 | 개인 설정 `design_plugin` 에 적은 설계 플러그인이 있으면 그 플러그인을, 없으면 wb 단계를 안내한다 |

### /wb:explain

- 언제: 무언가 막혔을 때, 아무것도 진행되지 않을 때, 차단 메시지의 뜻을 알고 싶을 때.
- 어떻게: `wb-explain` 이 설정 오류, 사용 한도, 게이트 실행 중, 멈춘 레인, 레인 상한, 가득 찬 실행 슬롯, 낡은 인계 파일, 남은 워크트리, 보호 브랜치를 확인한다. 차단 메시지는 `wb-explain code <코드>` 로 규칙과 연결한다. 읽기만 하며 설정을 바꾸지 않는다.
- 예시: 「방금 pkill 이 왜 막혔어?」

```
wb-explain code safety.kill.pattern
…
no-pattern-kill — 프로세스는 번호(PID)로만 종료
  프로세스를 이름이나 패턴으로 종료하지 않는다. 자기가 시작한 프로세스만 번호(PID)로 종료한다. …
  막혔을 때: `lsof -i :<포트>` 나 자기 실행 기록에서 PID 를 확인해 그 프로세스만 종료한다. …
```

### /wb:writing-style

- 언제: 화면 문구, 매뉴얼, 도움말, 보고서를 쓰거나 고칠 때. 지시서의 문체 줄을 채울 때.
- 어떻게: `wb-style of <경로>` 로 문체를 찾고 `wb-style rules <문체>` 로 규칙을 읽는다. 지시서는 `wb-style brief <틀> --owned <파일,…>` 로 채운다.
- 예시: 화면 문구를 해요체로 정하려면 `.wb/config.json` 에 다음을 넣는다.

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

### /wb:decide

- 언제: 구조·문구·범위처럼 소유자가 정할 사항이 생겼을 때. 웨이브를 시작할 때 대기 중인 결정을 확인할 때.
- 어떻게: 질문, 선택지 2~4개, 추천과 이유로 `wb-decide new` 를 실행한다. 답을 받으면 `wb-decide answer` 로 기록한다. 커밋은 제안만 한다. 대기 목록은 `wb-decide list --pending` 이다.
- 예시:

```
wb-decide new list-search --title "목록 화면 검색 상자 위치" --question "검색 상자를 어디에 둘까요?" \
  --option "A=목록 위 전체 폭" --option "B=목록 오른쪽 위 작은 상자" --recommend A
wb-decide list --pending
결정 대기	2026-10-17-list-search.md	목록 화면 검색 상자 위치
```

### /wb:lanes

- 언제: 어떤 레인이 돌고 있는지 볼 때, 웨이브와 레인을 만들 때.
- 어떻게: `wb-waves board` 결과를 그대로 보여 준다. 토큰과 모델 합계는 `wb-waves metrics` 다. 「진행」인데 `*` 가 없고 경과 시간이 늘어나는 레인은 멈췄을 가능성이 높으므로 `/wb:resume` 을 권한다.
- 예시:

```
wave/lane  상태       모델  작업        실행/되돌림  할 일  통과/실패  토큰  경과
w1/l1      검수 대기  opus  impl-multi  1/0          0/2    0/0        0     0m
```

### /wb:pickup

- 언제: 새 세션을 시작해 이전 작업을 이어받을 때.
- 어떻게: `progress.md` 를 처음부터 끝까지 읽고 `wb-waves resume` 을 실행한다. 오래된 항목을 먼저 보고하고, 다음 할 일과 재개·검수할 레인을 알려 준다. 워크트리나 브랜치를 스스로 지우지 않는다. 세션을 마칠 때는 아카이브와 `progress.md` 를 갱신해 함께 커밋하고 `/clear` 를 안내한다.
- 예시: `/wb:pickup`

```
# 먼저 보고할 오래된 항목
  - progress.md 이 최근 작업보다 오래됐습니다. 새 작업 전에 갱신하십시오.
```

### /wb:resume

- 언제: 사용량 한도나 오류로 웨이브가 중단된 뒤, 진행판에 멈춘 레인이 보일 때.
- 어떻게: `wb-waves resume` 보고를 보여 주고 오래된 항목을 먼저 알린다. 「검수 대기」 레인은 검수하고, 「멈춤」「시작 안 함」「실패」「막힘」 레인은 `wb-waves resume --prompt <웨이브>/<레인>` 문구로 같은 워크트리에 다시 보낸다. 다시 보내기 전에 `wb-waves status <웨이브> <레인> pending` 으로 상태를 돌린다.
- 예시: `/wb:resume`

### /wb:review-lane

- 언제: 레인이 보고를 마쳤을 때, 진행판에 「검수 대기」 레인이 있을 때.
- 어떻게: 검수 모델을 `wb-route resolve review --implementer <레인 모델>` 로 정한다. 화면 변경이면 캡처를 직접 열어 본 뒤 `--captures-seen` 을 붙인다. `wb-check lane` 을 통합 워크트리에서 실행한다. 통과(종료 코드 0)면 원장이 「완료」가 되고, 실패(1)면 되돌림 지시서가 생긴다. 레인 코드를 직접 고쳐 통과시키지 않는다.
- 예시: [시작하기](01-getting-started.md) 4.6절.

### /wb:integrate

- 언제: 검수를 통과한 레인을 통합 브랜치에 합칠 때.
- 어떻게: 통합 워크트리가 깨끗하고 게이트가 돌고 있지 않은지 확인한다. 큰 레인은 `--dry-run` 으로 먼저 확인한다. 웨이브의 레인을 모두 합친 뒤 전체 검증을 한 번 돌리고, 영향받는 서버를 다시 띄우고, 끝난 레인 워크트리를 지운다. 코드 충돌을 통합 워크트리에서 손으로 풀지 않으며, 보호 브랜치에 병합하지 않고 push 하지 않는다.
- 예시:

```
wb-integrate wb/search/l1 --lane l1 --wave w1 --trailer "Co-Authored-By: Claude <noreply@anthropic.com>"
wb/search/l1 를 병합했습니다. 새 HEAD b572a921d734
```

### /wb:test-report

- 언제: 통합·최종 검증의 증거가 필요할 때, 시험 결과를 엑셀로 달라는 요청을 받았을 때.
- 어떻게: `wb-test-report env` 로 준비를 확인하고, 처음이면 `wb-test-report init` 으로 설정을 만든다. `wb-test-report run --name <이름>` 으로 돌리고 xlsx 와 json 을 커밋한 뒤 `wb-check test-results` 로 확인한다. 초록색 결과를 위해 시험을 약하게 바꾸지 않는다.
- 예시:

```
wb-test-report summary
시험 결과 docs/test-results/2026-10-17/integration-2238.xlsx · 판정 통과 · 커밋 425ace6
  unit: 총 2 · 통과 2 · 실패 0 · 건너뜀 0 · 간헐 0
  gate: 1단계 · 실패 0 · 미실행 0
```

### /wb:report

- 언제: 웨이브가 취합·검증된 뒤, 끝난 작업을 다른 사람에게 보여 줘야 할 때.
- 어떻게: 시험 결과(`wb-check test-results --json`, `wb-test-report summary --json`), 결함 대장(`wb-defects summary --json`), 레인 원장(`wb-waves board --json`)을 모은다. 캡처를 `wb-art keep` 으로 보관하고, 본문을 Markdown 으로 쓰고, `wb-art report` 로 HTML 을 만들어 아티팩트로 게시한다. 보고는 「병합 준비 완료」에서 멈춘다. 「구현됨」과 「배포됨」을 구분해 적는다.
- 예시: [시작하기](01-getting-started.md) 4.8절.

### /wb:approve

- 언제: 보호 브랜치(`main` 등)에 병합·push·커밋해야 할 때. 저장소 소유자만 입력한다.
- 어떻게: `/wb:approve merge-main|push-main|commit-main [브랜치나 커밋]` 을 프롬프트에 직접 입력한다. 허가는 기본 15분 동안 한 번, 입력할 때의 커밋에만 유효하다. 게이트 명령을 설정한 프로젝트는 같은 커밋의 게이트 통과 표식도 필요하다. 상태는 `/wb:approve status`, 취소는 `/wb:approve revoke` 다. 강제 push 는 허가가 있어도 막힌다.
- 예시: `/wb:approve merge-main wb/search/int`

### /wb:auto-retry

- 언제: 한도 뒤 자동 재개 상태를 보거나 켜고 끌 때, 예약된 재개를 취소할 때.
- 어떻게: `wb-retry status`, `wb-retry on|off`, `wb-retry cancel <세션 앞부분|all>`, `wb-retry mode <모드>`, `wb-retry limits` 를 실행한다. Claude 는 `bypassPermissions` 를 스스로 켜지 않는다.
- 예시:

```
wb-retry status
자동 재개: 켜짐
재개 권한 모드: default
대기 중인 재개: 0건
```

### /wb:token-guard

- 언제: 사용량이 얼마나 남았는지 볼 때, 토큰 가드를 켜고 끄거나 예산을 보정할 때.
- 어떻게: `wb-token status`, `wb-token on|off`, `wb-token calibrate [<가중 토큰>]` 을 실행한다. 숫자 없이 보정하면 지금 사용량이 예산이 되므로, 앱에서 한도에 도달했다고 표시될 때 실행한다. 정확한 사용량은 `/usage` 로 본다.
- 예시: `/wb:token-guard calibrate`

### /wb:terse

- 언제: 출력과 도구 호출을 줄여 토큰을 아끼고 싶을 때.
- 어떻게: `wb-terse on|off|status`. 스위치는 저장소 단위이며 `/clear` 와 새 세션에도 유지된다. 켜는 즉시 Claude 가 `rules/terse.ko.md` 를 읽고 따른다. 모든 저장소에서 켜려면 `~/.wb/personal.json` 에 `"terse": true` 를 둔다. 검증 근거와 최종 보고는 줄이지 않는다.
- 예시:

```
wb-terse status
간결 모드: 꺼짐 (출처: default)
```
