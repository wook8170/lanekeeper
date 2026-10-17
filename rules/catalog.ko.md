# 규칙 카탈로그

각 규칙에 이유, 지키는 위치, 막혔을 때 복구 방법을 적었다. 이 파일은 `wb-rules render --write` 로 만든다. 직접 고치지 않는다.

## git 과 브랜치

### lane-own-branch

레인은 자기 레인 브랜치에만 커밋한다. push, 다른 브랜치로 이동, 통합 브랜치 병합은 하지 않는다.

- 왜: 여러 레인이 같은 브랜치에 쓰면 서로의 변경을 덮어쓰고, 어느 레인이 무엇을 바꿨는지 추적할 수 없게 된다.
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`
- 막혔을 때: 자기 레인 브랜치로 돌아와 커밋한다. 통합 브랜치의 최신 내용이 필요하면 통합 브랜치를 자기 브랜치로 받아 오는 병합만 한다. 반영은 취합 담당이 한다.

### no-force-push

강제 push 와 전체 브랜치 push 는 누구에게도 허용하지 않는다.

- 왜: 강제 push 는 다른 사람의 커밋을 지우고, 전체 push 는 보호 브랜치까지 함께 올린다.
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`
- 막혔을 때: 일반 push 로 바꾸고 올릴 브랜치를 하나만 지정한다. 이력을 고쳐야 하면 저장소 소유자에게 요청한다.

### protected-branch-owner-grant

보호 브랜치(main 등)에 반영하려면 소유자 허가가 필요하다. 허가는 한 번만, 정해진 시간 안에, 그 순간의 커밋에만 유효하다.

- 왜: 보호 브랜치는 모두가 기준으로 삼는다. 에이전트가 스스로 반영하면 검토되지 않은 변경이 기준선이 된다.
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`, `skills/approve/SKILL.md`, `hooks/scripts/safety/approve.mjs`
- 막혔을 때: 소유자가 프롬프트에 `/wb:approve merge-main` 처럼 직접 입력한다. 게이트 명령이 있으면 같은 커밋의 게이트 통과가 먼저 필요하다. 허가가 만료됐으면 다시 입력한다.

### gate-lock

검증 게이트가 실행되는 동안에는 병합하지 않는다.

- 왜: 게이트가 도는 사이에 코드가 바뀌면 통과 결과가 어느 커밋에 대한 것인지 알 수 없다.
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`
- 막혔을 때: 게이트가 끝날 때까지 기다린 뒤 다시 시도한다. 게이트가 멈췄다면 `wb-reap --gate-lock` 으로 오래된 잠금을 지우도록 소유자에게 요청한다.

### no-destructive-git

커밋하지 않은 변경이나 병합되지 않은 커밋을 지우는 git 명령(reset --hard, clean -f, branch -D, 이름 없는 stash)은 확인 없이 실행하지 않는다.

- 왜: 지운 변경은 되돌릴 수 없다. 이름 없는 stash 는 다른 세션과 같은 목록을 쓰므로 남의 변경을 꺼내거나 지울 수 있다.
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`
- 막혔을 때: 먼저 임시 커밋으로 변경을 보존한다. 정말 지워야 하면 지울 대상을 확인하고 확인 요청에 승인한다. stash 가 필요하면 고유한 이름을 붙인다.

### feature-push-ask

기능 브랜치 push 는 설정에 따라 확인을 받거나 막는다.

- 왜: 원격에 올라간 브랜치는 다른 사람이 보게 되므로, 올릴지 여부는 프로젝트가 정한다.
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`, 설정 `project.git.feature_push`
- 막혔을 때: 확인 요청이면 승인한다. 막혀 있으면 소유자에게 push 를 요청하거나 `project.git.feature_push` 값을 바꾼다.

### no-lane-pr-merge

레인은 PR 을 병합하지 않는다.

- 왜: 병합은 취합 담당이 검수를 마친 뒤에 하는 일이다.
- 어디서 지키나: `hooks/scripts/safety/pretool.mjs`
- 막혔을 때: 병합 요청은 취합 담당에게 넘기고, 자기 보고에 PR 번호와 상태를 적는다.

## 프로세스와 실행 환경

### no-pattern-kill

이름이나 패턴으로 프로세스를 종료하지 않는다. 자기가 띄운 프로세스의 PID 만 종료한다. 보호 포트를 쓰는 프로세스는 종료하지 않는다.

- 왜: 패턴 종료는 다른 작업이 띄운 서버까지 함께 종료한 사례가 있다. 소유자가 쓰는 서버가 꺼지면 작업이 중단된다.
- 어디서 지키나: `hooks/scripts/safety/kill-guard.mjs`
- 막혔을 때: `lsof -i :<포트>` 나 자기 실행 기록에서 PID 를 확인해 그 PID 만 종료한다. 보호 포트는 소유자에게 요청한다.

### lane-ports

레인은 자기에게 배정된 포트 범위만 쓴다. 포트는 `wb-port` 로 받는다.

- 왜: 같은 포트를 두 레인이 쓰면 한쪽 서버가 뜨지 못하거나 다른 레인의 서버를 잘못 확인하게 된다.
- 어디서 지키나: `bin/wb-port`, `lib/ports.mjs`
- 막혔을 때: `wb-port lease --lane <레인>` 으로 자기 포트를 받고 그 번호로 서버를 띄운다. 충돌하면 `wb-port list` 로 점유자를 확인한다.

### headless-browser

브라우저는 창이 뜨지 않는 헤드리스 모드로만 실행한다.

- 왜: 창이 뜨면 사용자가 쓰던 화면의 포커스를 빼앗아 작업이 끊긴다.
- 어디서 지키나: `hooks/scripts/safety/browser-guard.mjs`
- 막혔을 때: 명령에 `--headless=new` 를 붙이거나 헤드리스 도구를 쓴다. 화면을 직접 보여 줘야 하면 소유자가 요청했을 때만 한다.

### heavy-runs-in-slots

전체 시험·전체 빌드·설치·브라우저 실행은 `wb-slot` 안에서 실행한다.

- 왜: 무거운 실행이 여러 레인에서 겹치면 머신이 느려져 시간 초과로 가짜 실패가 난다.
- 어디서 지키나: `hooks/scripts/slots/slot-guard.mjs`, `bin/wb-slot`, 설정 `machine.slots`
- 막혔을 때: 같은 명령을 `wb-slot -- <명령>` 으로 감싸 실행한다. 자리가 없으면 비는 순서대로 기다린다.

## 파일과 명령 안전

### resolvable-commands

실행 전에 무엇을 하는지 알 수 없는 명령(변수나 명령 치환으로 만든 명령 이름·대상)은 막는다.

- 왜: 판정 대상이 실행 시점에야 정해지면 다른 안전 규칙이 그 명령을 검사할 수 없다.
- 어디서 지키나: `hooks/scripts/safety/shell.mjs`, `hooks/scripts/safety/git-guard.mjs`, `hooks/scripts/safety/kill-guard.mjs`
- 막혔을 때: 변수를 실제 값으로 풀어서 다시 입력한다. 대상이 길면 먼저 값을 출력해 확인한 뒤 그 값을 직접 쓴다.

### rm-inside-project

재귀 삭제(`rm -r`)는 프로젝트 폴더 안의 확인된 경로에만 한다.

- 왜: 홈·시스템 폴더나 git 내부 폴더를 지우면 복구할 수 없다. 변수로 만든 경로는 비어 있을 때 상위 폴더 전체를 지운다.
- 어디서 지키나: `hooks/scripts/safety/destructive.mjs`
- 막혔을 때: 지울 경로를 실제 값으로 적어 다시 실행한다. 프로젝트 밖은 소유자에게 요청한다.

### protected-paths

보호 경로와 wb 상태 파일, wb 설정은 에이전트가 직접 쓰지 않는다.

- 왜: 허가 파일이나 설정을 에이전트가 고치면 안전 규칙을 스스로 풀 수 있다.
- 어디서 지키나: `hooks/scripts/safety/paths.mjs`, 설정 `project.protected_paths`
- 막혔을 때: 상태 파일은 `wb-*` 도구로만 바꾼다. 설정 변경은 소유자가 직접 하거나 승인한다.

### human-only-approve

`/wb:approve` 는 사람이 프롬프트에 직접 입력할 때만 동작한다.

- 왜: 에이전트가 스스로 허가를 만들 수 있다면 소유자 허가가 의미를 잃는다.
- 어디서 지키나: `hooks/scripts/safety/approve.mjs`, `skills/approve/SKILL.md`
- 막혔을 때: 소유자에게 어떤 작업에 허가가 필요한지 알리고 직접 입력해 달라고 요청한다.

### safety-fails-closed

안전 훅이 판정할 수 없거나 설정이 깨져 있으면 실행을 막는다.

- 왜: 판정을 못 했는데 통과시키면 안전 규칙이 가장 필요한 순간에 빠진다.
- 어디서 지키나: `hooks/scripts/safety/pretool.mjs`, `hooks/scripts/safety/context.mjs`
- 막혔을 때: `/wb:doctor` 로 설정 오류의 파일과 키를 확인해 고치고 `wb-config validate` 로 확인한다.

## 모델과 지시서

### model-routing

서브에이전트는 작업 종류에 맞는 모델로 띄운다. 금지 모델과 사슬 밖 모델, 바닥선 아래 모델은 쓰지 않는다.

- 왜: 작업마다 요구되는 판단 수준이 다르다. 낮은 모델에 설계나 검수를 맡기면 놓친 결함이 뒤에서 더 큰 비용이 된다.
- 어디서 지키나: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-route`, 설정 `routing`
- 막혔을 때: `wb-route resolve <작업>` 이 알려 주는 모델로 다시 띄운다. 한도가 소진돼 기다려야 하면 바닥선 아래로 내리지 말고 리셋 시각까지 기다린다.

### implementer-verifier-differ

검수와 적대적 검토는 구현한 모델과 다른 모델로 한다. 다른 모델이 없으면 같은 모델을 새 문맥에서 쓰고 보고에 적는다.

- 왜: 같은 모델이 자기 결과를 다시 보면 같은 착각을 반복하기 쉽다.
- 어디서 지키나: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-route`
- 막혔을 때: `wb-route explain <작업> --implementer <모델>` 로 쓸 수 있는 모델을 확인해 그 모델로 띄운다.

### brief-required

레인을 띄울 때는 표지와 필수 절(목표·범위·금지·시험·보고·커밋)이 있는 지시서를 쓴다.

- 왜: 지시가 말로만 전달되면 범위와 금지 사항이 빠져 레인이 다른 레인의 파일을 건드리거나 보고를 남기지 않는다.
- 어디서 지키나: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-check`, `templates/briefs/ko/impl.md`, 설정 `dispatch.brief`
- 막혔을 때: `wb-check brief <파일>` 로 빠진 항목을 확인하고 `templates/briefs/` 의 틀로 채운 뒤 다시 띄운다.

### lane-cap

동시에 살아 있는 레인은 정해진 수(기본 3개)를 넘기지 않는다.

- 왜: 레인이 많으면 머신 부하가 올라 시험이 시간 초과로 실패하고 취합 검수가 따라가지 못한다.
- 어디서 지키나: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-worktree`, 설정 `machine.lanes.max`
- 막혔을 때: 끝난 레인을 취합하고 워크트리를 정리한 뒤 새 레인을 연다. `/wb:lanes` 로 살아 있는 레인을 확인한다.

### lane-test-scope

레인은 자기가 만들거나 고친 시험 파일만 실행한다. 전체 시험과 전 패키지 점검은 취합 담당이 한 번만 한다.

- 왜: 레인마다 전체 시험을 돌리면 부하가 겹쳐 시간 초과 실패가 나고, 같은 결과를 여러 번 얻는다.
- 어디서 지키나: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`, `hooks/scripts/slots/slot-guard.mjs`
- 막혔을 때: 지시서 「시험 규칙」 대로 단독 시험만 실행한다. 전체 시험이 필요하다고 판단되면 보고에 적어 취합 담당에게 넘긴다.

### report-twice

레인은 보고를 파일로 쓰고 같은 내용을 최종 응답으로도 반환한다. 큰 항목을 끝낼 때마다 중간 기록을 남긴다.

- 왜: 응답이 비거나 중단돼도 결과가 남아야 한다. 파일만 있으면 취합 담당이 읽기 전에는 완료를 알 수 없다.
- 어디서 지키나: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`
- 막혔을 때: 보고 파일 경로(지시서 「보고 위치」)에 현재까지의 내용을 쓰고 응답에도 요약을 붙인다.

### base-commit

레인은 시작할 때 지시서의 기준 커밋과 워크트리의 HEAD 가 같은지 확인하고, 다르면 작업 전에 보고한다.

- 왜: 오래된 기준에서 작업하면 이미 고쳐진 문제를 다시 고치거나, 병합 때 충돌이 커진다.
- 어디서 지키나: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`
- 막혔을 때: `git log -1` 결과를 지시서와 비교한다. 다르면 통합 브랜치를 받아 온 뒤 시작하거나 취합 담당에게 알린다.

## 세션과 인계

### progress-handoff

세션을 시작하면 `progress.md` 를 먼저 읽고, 작업 단위가 끝날 때마다 갱신한다. 세션이 낡은 `progress.md` 로 끝나지 않게 한다.

- 왜: 맥락이 지워진 새 세션은 `progress.md` 만 보고 이어받는다. 낡아 있으면 끝난 일을 다시 하거나 중간 상태를 놓친다.
- 어디서 지키나: `hooks/scripts/handoff/session-start.mjs`, `hooks/scripts/handoff/stop-guard.mjs`, `skills/pickup/SKILL.md`
- 막혔을 때: 완료한 것, 진행 중인 것, 바로 할 일, 확인 대기, 주의할 점을 `progress.md` 에 적고 커밋한 뒤 종료한다.

### wave-checkpoint

웨이브(작업 단위)가 끝나면 진행 기록을 커밋하고, 사용자에게 `/clear` 를 안내한다.

- 왜: 맥락이 커지면 긴 세션이 한도에 걸려 중단된다. 일찍 기록해 두면 어느 시점에서든 새 세션이 이어받을 수 있다.
- 어디서 지키나: `hooks/scripts/checkpoint/checkpoint.mjs`, `skills/resume/SKILL.md`
- 막혔을 때: `/wb:resume` 으로 재개 보고를 만들고 오래된 항목부터 정리한다.

### token-stages

토큰 사용량이 90%·95%·99% 에 이르면 단계별 지침(작업 축소, 매 웨이브 핸드오프, 마지막 핸드오프 후 대기)을 따른다.

- 왜: 한도에 걸려 갑자기 멈추면 기록되지 않은 작업이 사라진다.
- 어디서 지키나: `hooks/scripts/token-guard/check.mjs`, `skills/token-guard/SKILL.md`, 설정 `personal.token_guard`
- 막혔을 때: 지침이 나오면 진행 중인 작업을 마무리하고 `progress.md` 를 갱신한다. 기준을 바꾸려면 `/wb:token-guard` 를 쓴다.

### auto-retry-default-permission

사용량 한도로 멈춘 세션의 자동 재개는 기본 권한 모드로만 한다.

- 왜: 무인으로 다시 시작하는 세션이 권한 확인을 건너뛰면 아무도 보지 않는 사이 위험한 작업이 실행될 수 있다.
- 어디서 지키나: `hooks/scripts/auto-retry/detect.mjs`, `skills/auto-retry/SKILL.md`, 설정 `personal.auto_retry.permission_mode`
- 막혔을 때: `/wb:auto-retry status` 로 예약을 확인한다. 권한 모드를 올리려면 사용자가 직접 확인 절차를 거친다.

### terse-mode

간결 모드가 켜져 있으면 출력과 도구 호출을 줄이되, 검증 근거와 최종 보고는 줄이지 않는다.

- 왜: 토큰을 아끼는 것이 목적이지, 확인 없이 결과를 주장하는 것이 목적이 아니다.
- 어디서 지키나: `hooks/scripts/terse/session-start.mjs`, `skills/terse/SKILL.md`, `rules/terse.ko.md`
- 막혔을 때: `/wb:terse off` 로 끈다.

## 품질과 문서

### tests-with-change

기능을 추가·수정·삭제할 때는 같은 변경에서 관련 시험을 함께 맞춘다. 못 고친 결함은 시험을 약하게 바꾸지 않고 보류 표시와 결함 기록으로 남긴다.

- 왜: 시험이 없는 변경, 지운 기능을 붙잡는 시험, 동작과 다른 기대값은 모두 다음 변경에서 문제가 된다.
- 어디서 지키나: `templates/briefs/ko/impl.md`, `bin/wb-defects`, `bin/wb-cases`
- 막혔을 때: 지시서 「시험 규칙」 대로 시험을 고친다. 못 고친 결함은 `wb-defects add` 로 기록한다.

### test-results-workbook

시험 결과는 엑셀 파일로 저장하고 커밋한다. 결과 파일이 없으면 보고를 마칠 수 없다.

- 왜: 통과했다는 말만으로는 무엇을 몇 건 확인했는지 나중에 확인할 수 없다.
- 어디서 지키나: `bin/wb-test-report`, `bin/wb-check`, `skills/test-report/SKILL.md`
- 막혔을 때: `/wb:test-report` 로 결과 파일을 만들고 `wb-check test-results` 로 확인한다.

### number-reservation

번호가 붙는 파일(마이그레이션, 결정 기록 등)은 번호를 먼저 예약한 뒤 만든다.

- 왜: 병렬 레인이 같은 번호를 고르면 병합 때 충돌하고 번호를 다시 매겨야 한다.
- 어디서 지키나: `bin/wb-number`, `lib/numbers.mjs`, 설정 `project.numbers`
- 막혔을 때: `wb-number reserve <계열> --lane <레인>` 으로 번호를 받아 쓴다. 이미 겹쳤다면 늦게 만든 쪽의 번호를 바꾼다.

### worktree-cleanup

끝난 레인 워크트리는 대상 브랜치에 병합한 뒤 지운다. 지우기 전에 그 경로에서 뜬 프로세스를 PID 로 먼저 종료한다.

- 왜: 남은 워크트리의 고아 프로세스가 CPU 를 쓰고, 인계가 갈라진다.
- 어디서 지키나: `bin/wb-worktree`, `bin/wb-reap`, `skills/resume/SKILL.md`
- 막혔을 때: `wb-reap` 으로 정리 대상을 확인하고 `wb-worktree remove <레인>` 으로 지운다.

### owner-decisions-recorded

소유자가 정한 사항은 결정 기록(`docs/decisions/`)으로 남긴다.

- 왜: 말로만 정해진 사항은 다음 세션이 알 수 없고, 같은 질문이 반복된다.
- 어디서 지키나: `skills/decide/SKILL.md`, `bin/wb-decide`, 설정 `project.paths.decisions`
- 막혔을 때: `/wb:decide` 로 질문을 정리해 답을 받고 결정 기록을 만든다.

### style-per-file

문서와 화면 문구는 파일 종류별로 정한 문체(`style.map`)로 쓴다.

- 왜: 같은 제품 안에서 화면은 쉬운 말, 보고서는 업무 문체로 갈라 쓰지 않으면 독자마다 다른 인상을 받는다.
- 어디서 지키나: `skills/writing-style/SKILL.md`, `bin/wb-style`, `templates/briefs/ko/docs.md`, 설정 `project.style.map`
- 막혔을 때: `wb-style of <파일>` 로 문체를 확인하고 `wb-style rules <문체>` 의 규칙대로 고친다.

### mockup-first

화면 구조를 바꾸는 작업은 구현 전에 시안을 보이고 결정을 받는다.

- 왜: 구현한 뒤에 구조가 반려되면 작업 전체를 다시 해야 한다.
- 어디서 지키나: `hooks/scripts/mockup/mockup-first.mjs`, `bin/wb-decide`, 설정 `project.mockup`
- 막혔을 때: 시안을 아티팩트로 보이고 `wb-decide new <이름> --kind mockup --scope <경로>` 로 결정 문서를 만든 뒤 `wb-decide answer` 로 선택을 기록하고 커밋한다. 결정 문서의 scope 가 고치려는 파일을 덮어야 한다.

### codegraph-first

흐름·호출처·변경 영향은 코드 색인(codegraph)으로 보고, 정확한 줄 번호와 문자열은 텍스트 검색으로 확인한다.

- 왜: 호출처를 텍스트 검색으로 하나씩 따라가면 호출 수가 늘어난다. 반대로 색인만으로는 줄 번호와 일부 호출 관계가 빠지므로 텍스트 검색을 막지는 않는다.
- 어디서 지키나: `hooks/scripts/codegraph/nudge.mjs`, `hooks/scripts/codegraph/session-start.mjs`, 설정 `project.codegraph.nudge`
- 막혔을 때: 안내가 나오면 같은 질문을 `codegraph_callers` 나 `codegraph_explore` 로 한 번 물어본다. 안내를 끄려면 `project.codegraph.nudge` 를 `off` 로 둔다.

### codegraph-index-first

색인이 없는 경로로 codegraph 를 다시 부르지 않는다. 새 워크트리는 만들 때 색인 대기열에 넣는다.

- 왜: 색인 도구 실패의 대부분은 새로 만든 워크트리에 색인이 없어서였고, 실패한 경로로 다시 부르는 시도가 비용만 늘렸다.
- 어디서 지키나: `hooks/scripts/codegraph/deadpath.mjs`, `hooks/scripts/codegraph/record.mjs`, `bin/wb-index`, 설정 `project.codegraph.index_on_worktree`
- 막혔을 때: grep 과 Read 로 진행한다. `wb-index status` 로 색인 진행을 보고, 색인이 생기면 같은 세션에서도 다시 부를 수 있다. 직접 넣으려면 `wb-index add <경로>` 를 쓴다.

## 추가 예정

### glossary-terms

화면 문구의 낱말은 프로젝트 용어 사전을 따른다.

- 왜: 같은 개념을 화면마다 다른 말로 부르면 사용자가 헷갈린다.
- 어디서 지키나: 아직 없음(L10 레인에서 추가)
- 막혔을 때: 사전 검사가 들어오기 전에는 `style.map` 의 haeyo 규칙과 기존 화면의 낱말을 따른다.
