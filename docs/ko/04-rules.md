# 규칙 안내

wb 는 아래 규칙 52개를 훅과 명령으로 지킨다. 이 문서는 규칙마다 무엇을 막는지, 왜 막는지, 걸렸을 때 어떻게 고치는지를 적었다.

훅의 판정은 세 가지다. 차단은 명령을 실행하지 않는다. 확인 요청은 사용자에게 진행 여부를 묻는다. 안내는 명령을 실행하고 다음에 할 일을 알려 준다.

차단 메시지는 세 줄이다. 첫 줄은 막은 이유, 둘째 줄은 고치는 법, 셋째 줄은 물어볼 곳이다. 메시지에 적힌 코드(예: `safety.git.lane_commit`)로 규칙을 찾으려면 `wb-explain code <코드>` 를 실행한다. 지금 막혀 있는 것을 한꺼번에 보려면 `/wb:explain` 을 실행한다.

규칙은 처음 쓰는 사람이 자주 만나는 순서로 묶었다. git 과 브랜치, 파일과 명령 안전, 프로세스와 실행 환경, 모델과 지시서, 세션과 인계, 품질과 문서, 추가 예정 순이다.

> 이 문서는 `rules/catalog.json` 에서 `wb-rules manual --write` 로 만든다. 내용을 바꿀 때는 카탈로그를 고치고 다시 만든다.

## 규칙 목록

| 번호 | 규칙 | id | 묶음 |
|---|---|---|---|
| 1 | 레인은 자기 브랜치에만 커밋 | `lane-own-branch` | git 과 브랜치 |
| 2 | 강제 push 금지 | `no-force-push` | git 과 브랜치 |
| 3 | 보호 브랜치 반영은 소유자 허가 후 | `protected-branch-owner-grant` | git 과 브랜치 |
| 4 | 게이트 실행 중 병합 금지 | `gate-lock` | git 과 브랜치 |
| 5 | 변경을 지우는 git 명령은 확인 후 실행 | `no-destructive-git` | git 과 브랜치 |
| 6 | 기능 브랜치 push 는 설정대로 | `feature-push-ask` | git 과 브랜치 |
| 7 | 레인은 PR 병합 금지 | `no-lane-pr-merge` | git 과 브랜치 |
| 8 | 레인 커밋은 프로젝트 정책대로 | `lane-commit-policy` | git 과 브랜치 |
| 9 | 실행 전에 대상을 알 수 있는 명령만 실행 | `resolvable-commands` | 파일과 명령 안전 |
| 10 | 폴더 삭제는 프로젝트 안에서만 | `rm-inside-project` | 파일과 명령 안전 |
| 11 | 보호 경로와 wb 설정은 에이전트가 고치지 않음 | `protected-paths` | 파일과 명령 안전 |
| 12 | 허가 명령은 사람만 입력 | `human-only-approve` | 파일과 명령 안전 |
| 13 | 판정할 수 없으면 차단 | `safety-fails-closed` | 파일과 명령 안전 |
| 14 | 시험 데이터는 보호 데이터에 쓰지 않음 | `protected-data` | 파일과 명령 안전 |
| 15 | 프로세스는 번호(PID)로만 종료 | `no-pattern-kill` | 프로세스와 실행 환경 |
| 16 | 레인은 배정받은 포트만 사용 | `lane-ports` | 프로세스와 실행 환경 |
| 17 | 브라우저는 창 없이 실행 | `headless-browser` | 프로세스와 실행 환경 |
| 18 | 무거운 실행은 실행 슬롯 안에서 | `heavy-runs-in-slots` | 프로세스와 실행 환경 |
| 19 | 작업 종류에 맞는 모델 사용 | `model-routing` | 모델과 지시서 |
| 20 | 검수는 구현과 다른 모델로 | `implementer-verifier-differ` | 모델과 지시서 |
| 21 | 레인은 지시서로 시작 | `brief-required` | 모델과 지시서 |
| 22 | 동시 레인 수 상한 | `lane-cap` | 모델과 지시서 |
| 23 | 부하 단계에 따른 레인 조정 | `load-tiers` | 모델과 지시서 |
| 24 | 레인은 자기 시험만 실행 | `lane-test-scope` | 모델과 지시서 |
| 25 | 보고는 파일과 응답 두 곳에 | `report-twice` | 모델과 지시서 |
| 26 | 시작 커밋 확인 | `base-commit` | 모델과 지시서 |
| 27 | progress.md 로 다음 세션에 인계 | `progress-handoff` | 세션과 인계 |
| 28 | 작업 단위마다 기록 커밋 | `wave-checkpoint` | 세션과 인계 |
| 29 | 사용량 단계별 대응 | `token-stages` | 세션과 인계 |
| 30 | 자동 재개는 기본 권한으로 | `auto-retry-default-permission` | 세션과 인계 |
| 31 | 간결 모드에서도 근거는 유지 | `terse-mode` | 세션과 인계 |
| 32 | 출력 언어는 설정대로 | `output-language` | 세션과 인계 |
| 33 | 원격 사용자에게는 아티팩트로 | `remote-viewer` | 세션과 인계 |
| 34 | 구현과 반영을 구분해 보고 | `report-accuracy` | 세션과 인계 |
| 35 | 모호하면 되묻고 반복 질문에 먼저 답함 | `communication` | 세션과 인계 |
| 36 | 기능과 시험은 함께 변경 | `tests-with-change` | 품질과 문서 |
| 37 | 시험 결과는 엑셀로 저장 | `test-results-workbook` | 품질과 문서 |
| 38 | 설계는 적대 검증 「높음 0건」 뒤에 구현 | `design-adversarial-review` | 품질과 문서 |
| 39 | 출하 검증 전에 선행 검증 통과 | `ship-precheck` | 품질과 문서 |
| 40 | 번호는 먼저 예약 | `number-reservation` | 품질과 문서 |
| 41 | 끝난 작업 폴더 정리 | `worktree-cleanup` | 품질과 문서 |
| 42 | 소유자 결정은 문서로 | `owner-decisions-recorded` | 품질과 문서 |
| 43 | 파일 종류별 문체 | `style-per-file` | 품질과 문서 |
| 44 | 화면 구조 변경은 시안 먼저 | `mockup-first` | 품질과 문서 |
| 45 | 끝난 작업은 아티팩트로 보고 | `report-artifact` | 품질과 문서 |
| 46 | 코드 흐름은 코드 색인으로 확인 | `codegraph-first` | 품질과 문서 |
| 47 | 색인 없는 경로는 다시 조회하지 않음 | `codegraph-index-first` | 품질과 문서 |
| 48 | 텍스트 검색은 rg | `rg-search` | 품질과 문서 |
| 49 | 임시방편 대신 근본 원인 수정 | `root-cause-fix` | 품질과 문서 |
| 50 | 제품 화면에 이모지 금지 | `no-emoji-ui` | 품질과 문서 |
| 51 | 색인 도구가 없으면 설치하고 계속 | `codegraph-install` | 품질과 문서 |
| 52 | 화면 낱말은 용어 사전대로 | `glossary-terms` | 추가 예정 |

## git 과 브랜치

레인과 메인 세션이 어느 브랜치에 커밋·병합·push 할 수 있는지 정한다. `git` 명령을 실행하기 전에 안전 훅이 판정한다.

### 1. 레인은 자기 브랜치에만 커밋 (`lane-own-branch`)

- 규칙: 레인은 자기 레인 브랜치에만 커밋한다. push, 다른 브랜치로 이동, 통합 브랜치로의 병합은 하지 않는다.
- 왜: 여러 레인이 한 브랜치에 커밋하면 서로의 변경을 덮어쓴다. 어느 레인이 무엇을 바꿨는지도 알 수 없게 된다.
- 막혔을 때: 자기 레인 브랜치로 돌아가 커밋한다. 통합 브랜치의 최신 내용이 필요하면 통합 브랜치를 자기 브랜치로 병합한다. 통합 브랜치 반영은 취합 담당이 한다.
- 메시지 코드: `safety.git.lane_*`
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`

### 2. 강제 push 금지 (`no-force-push`)

- 규칙: 강제 push 와 저장소 전체 push(--all, --mirror)는 누구에게도 허용하지 않는다.
- 왜: 강제 push 는 다른 사람의 커밋을 지운다. 전체 push 는 보호 브랜치까지 함께 올린다.
- 막혔을 때: 일반 push 로 브랜치 하나만 지정해 올린다. 이력을 고쳐야 하면 저장소 소유자에게 요청한다.
- 메시지 코드: `safety.git.force_push`, `safety.git.push_all`
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`

### 3. 보호 브랜치 반영은 소유자 허가 후 (`protected-branch-owner-grant`)

- 규칙: main 같은 보호 브랜치에 반영하려면 소유자 허가가 필요하다. 허가는 정해진 시간 안에 한 번만 쓸 수 있고, 허가할 때 지정한 커밋에만 적용된다.
- 왜: 보호 브랜치는 모든 작업의 기준이 된다. 에이전트가 직접 반영하면 검토하지 않은 변경이 기준이 된다.
- 막혔을 때: 소유자가 프롬프트에 `/wb:approve merge-main` 처럼 직접 입력한다. 게이트 명령을 설정했다면 같은 커밋으로 게이트를 먼저 통과해야 한다. 허가 시간이 지났으면 다시 입력한다.
- 메시지 코드: `safety.git.main_merge`, `safety.git.branch_protected`, `safety.grant.*`, `safety.stamp.*`, `safety.approve.*`
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`, `skills/approve/SKILL.md`, `hooks/scripts/safety/approve.mjs`

### 4. 게이트 실행 중 병합 금지 (`gate-lock`)

- 규칙: 게이트가 실행되는 동안에는 병합하지 않는다.
- 왜: 게이트 실행 중에 코드가 바뀌면 통과 결과가 어느 커밋의 것인지 알 수 없다.
- 막혔을 때: 게이트가 끝난 뒤 다시 시도한다. 게이트가 멈춘 채 잠금만 남았다면 소유자에게 `wb-reap --gate-lock` 으로 잠금을 지워 달라고 요청한다.
- 메시지 코드: `safety.git.gate_locked`
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`, `bin/wb-test-report`

### 5. 변경을 지우는 git 명령은 확인 후 실행 (`no-destructive-git`)

- 규칙: 커밋하지 않은 변경이나 병합하지 않은 커밋을 지우는 git 명령(reset --hard, clean -f, branch -D, 이름 없는 stash)은 확인 없이 실행하지 않는다.
- 왜: 지운 변경은 되돌릴 수 없다. 이름 없는 stash 는 다른 세션과 목록을 함께 쓰므로 다른 사람의 변경을 꺼내거나 지울 수 있다.
- 막혔을 때: 먼저 임시 커밋으로 변경을 남긴다. 꼭 지워야 하면 대상을 확인한 뒤 확인 요청을 승인한다. stash 를 써야 하면 고유한 이름을 붙인다.
- 메시지 코드: `safety.git.reset_hard`, `safety.git.clean`, `safety.git.branch_delete`, `safety.git.ref`, `safety.git.stash`
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`

### 6. 기능 브랜치 push 는 설정대로 (`feature-push-ask`)

- 규칙: 기능 브랜치 push 는 프로젝트 설정에 따라 확인을 받거나 막는다.
- 왜: 원격 저장소에 올린 브랜치는 다른 사람도 본다. 에이전트가 올려도 되는지는 프로젝트가 정한다.
- 막혔을 때: 확인 요청이 나오면 승인한다. 막혔으면 소유자에게 push 를 요청하거나 `project.git.feature_push` 값을 바꾼다.
- 메시지 코드: `safety.git.push_feature`, `safety.git.push_feature_denied`
- 관련 설정: `project.git.feature_push`
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`

### 7. 레인은 PR 병합 금지 (`no-lane-pr-merge`)

- 규칙: 레인은 PR 을 병합하지 않는다.
- 왜: 병합은 취합 담당이 검수를 마친 뒤에 한다.
- 막혔을 때: 병합은 취합 담당에게 맡기고, 보고에 PR 번호와 상태를 적는다.
- 메시지 코드: `safety.gh.*`
- 어디서 지키나: `hooks/scripts/safety/pretool.mjs`

### 8. 레인 커밋은 프로젝트 정책대로 (`lane-commit-policy`)

- 규칙: `project.lanes.commit` 이 `on-instruction` 이면 레인은 지시서에 커밋 허용 표식(`commit=allowed` 또는 「커밋 허용」 줄)이 있을 때만 커밋한다. 표식이 없으면 커밋 전에 확인을 받는다. 기본값 `allowed` 는 지금처럼 자기 브랜치 커밋을 허용한다.
- 왜: 검수 전 변경을 커밋하지 않고 작업 트리에 두게 하는 프로젝트가 있다. 레인이 지시 없이 커밋하면 취합 담당이 검수 전 상태와 검수 후 상태를 구분하기 어렵다.
- 막혔을 때: 커밋하지 말고 변경을 작업 트리에 둔 채 보고한다. 커밋이 필요하면 메인 세션이 지시서 표지에 `commit=allowed` 를 넣어 다시 디스패치한다.
- 메시지 코드: `safety.git.lane_commit_instruction`
- 관련 설정: `project.lanes.commit`
- 어디서 지키나: `hooks/scripts/safety/git-guard.mjs`, `hooks/scripts/checkpoint/checkpoint.mjs`

## 파일과 명령 안전

되돌릴 수 없는 삭제와 판정할 수 없는 명령을 막는다. 설정이 깨졌을 때도 위험한 명령은 막는다.

### 9. 실행 전에 대상을 알 수 있는 명령만 실행 (`resolvable-commands`)

- 규칙: 변수나 명령 치환으로 명령 이름이나 대상을 만드는 명령은 막는다.
- 왜: 실행 대상이 실행 시점에야 정해지면 다른 안전 규칙이 그 명령을 검사할 수 없다.
- 막혔을 때: 변수 대신 실제 값을 써서 다시 실행한다. 값이 길면 먼저 출력해 확인한 뒤 그 값을 그대로 쓴다.
- 메시지 코드: `safety.shell.unresolved`, `safety.git.unresolved`, `safety.kill.unresolved`
- 어디서 지키나: `hooks/scripts/safety/shell.mjs`, `hooks/scripts/safety/git-guard.mjs`, `hooks/scripts/safety/kill-guard.mjs`

### 10. 폴더 삭제는 프로젝트 안에서만 (`rm-inside-project`)

- 규칙: 폴더째 지우는 명령(`rm -r`)은 프로젝트 폴더 안의 확인된 경로에만 쓴다.
- 왜: 홈 폴더, 시스템 폴더, git 내부 폴더를 지우면 복구할 수 없다. 변수로 만든 경로는 변수가 비어 있으면 상위 폴더 전체를 지운다.
- 막혔을 때: 지울 경로를 실제 값으로 적어 다시 실행한다. 프로젝트 밖의 경로는 소유자에게 요청한다.
- 메시지 코드: `safety.rm.*`
- 어디서 지키나: `hooks/scripts/safety/destructive.mjs`

### 11. 보호 경로와 wb 설정은 에이전트가 고치지 않음 (`protected-paths`)

- 규칙: 보호 경로, wb 상태 파일, wb 설정 파일은 에이전트가 직접 고치지 않는다.
- 왜: 에이전트가 허가 파일이나 설정을 고칠 수 있으면 안전 규칙을 스스로 풀 수 있다.
- 막혔을 때: 상태 파일은 `wb-*` 명령으로만 바꾼다. 설정은 소유자가 직접 바꾸거나 변경을 승인한다.
- 메시지 코드: `safety.paths.*`
- 관련 설정: `project.protected_paths`
- 어디서 지키나: `hooks/scripts/safety/paths.mjs`

### 12. 허가 명령은 사람만 입력 (`human-only-approve`)

- 규칙: `/wb:approve` 는 사람이 프롬프트에 직접 입력했을 때만 동작한다.
- 왜: 에이전트가 허가를 스스로 만들 수 있으면 소유자 허가 절차가 의미가 없어진다.
- 막혔을 때: 어떤 작업에 허가가 필요한지 소유자에게 알리고, 직접 입력해 달라고 요청한다.
- 메시지 코드: `safety.approve.*`
- 어디서 지키나: `hooks/scripts/safety/approve.mjs`, `skills/approve/SKILL.md`

### 13. 판정할 수 없으면 차단 (`safety-fails-closed`)

- 규칙: 안전 검사가 판정하지 못하거나 설정 파일에 오류가 있으면 실행을 막는다. 안전 훅·디스패치 가드·출하 관문 훅 자체가 실행되지 않거나 시간이 초과되면 Claude Code 가 그 호출을 막는다(`onFailure: block`).
- 왜: 판정하지 못한 명령을 통과시키면 안전 규칙이 가장 필요한 때에 동작하지 않는다.
- 막혔을 때: `/wb:doctor` 로 오류가 난 파일과 키를 확인해 고친다. 고친 뒤 `wb-config validate` 로 다시 확인한다.
- 메시지 코드: `safety.config.*`, `safety.internal`
- 어디서 지키나: `hooks/scripts/safety/pretool.mjs`, `hooks/scripts/safety/context.mjs`, `hooks/hooks.json`

### 14. 시험 데이터는 보호 데이터에 쓰지 않음 (`protected-data`)

- 규칙: `project.protected_data` 에 등록한 DB 파일·DB 포트·컨테이너에 쓰는 명령은 레인에서 막고, 메인 세션에서는 확인을 받는다. 쓰기인지 판정할 수 없으면 확인을 받는다. 읽기 질의는 통과한다.
- 왜: 시험 중 만든 행이나 이미지가 소유자·운영 DB 에 섞이면 되돌리기 어렵고, 실제 데이터와 시험 데이터를 구분할 수 없게 된다.
- 막혔을 때: 레인 전용 시험 DB(배정 포트·전용 컨테이너·시험용 파일)로 바꿔 실행한다. 읽기만 하는 질의는 `-c`·`-e` 뒤에 SELECT 문을 직접 적으면 통과한다.
- 메시지 코드: `safety.data.*`
- 관련 설정: `project.protected_data`
- 어디서 지키나: `hooks/scripts/safety/data-guard.mjs`, `hooks/scripts/safety/pretool.mjs`

## 프로세스와 실행 환경

여러 레인이 한 머신을 함께 쓸 때 서로의 프로세스·포트·화면을 건드리지 않게 한다.

### 15. 프로세스는 번호(PID)로만 종료 (`no-pattern-kill`)

- 규칙: 프로세스를 이름이나 패턴으로 종료하지 않는다. 자기가 시작한 프로세스만 번호(PID)로 종료한다. 보호 포트를 쓰는 프로세스는 종료하지 않는다.
- 왜: 패턴으로 종료하면 다른 작업이 띄운 서버까지 함께 꺼진다. 소유자가 쓰는 서버가 꺼지면 그 작업도 멈춘다.
- 막혔을 때: `lsof -i :<포트>` 나 자기 실행 기록에서 PID 를 확인해 그 프로세스만 종료한다. 보호 포트의 프로세스는 소유자에게 요청한다.
- 메시지 코드: `safety.kill.pattern`, `safety.kill.protected_port`
- 어디서 지키나: `hooks/scripts/safety/kill-guard.mjs`

### 16. 레인은 배정받은 포트만 사용 (`lane-ports`)

- 규칙: 레인은 자기에게 배정된 포트만 쓴다. 포트는 `wb-port` 로 받는다.
- 왜: 두 레인이 같은 포트를 쓰면 한쪽 서버가 뜨지 않는다. 다른 레인의 서버를 자기 서버로 알고 확인할 수도 있다.
- 막혔을 때: `wb-port lease --lane <레인>` 으로 포트를 받아 그 번호로 서버를 띄운다. 포트가 겹치면 `wb-port list` 로 사용 중인 쪽을 확인한다.
- 어디서 지키나: `bin/wb-port`, `lib/ports.mjs`

### 17. 브라우저는 창 없이 실행 (`headless-browser`)

- 규칙: 브라우저는 창을 띄우지 않는 헤드리스 모드로만 실행한다.
- 왜: 창이 뜨면 사용자가 쓰던 화면의 입력 초점을 가져가 하던 일이 끊긴다.
- 막혔을 때: 명령에 `--headless=new` 를 붙이거나 헤드리스 도구를 쓴다. 창은 소유자가 요청한 경우에만 띄운다.
- 메시지 코드: `safety.browser.*`
- 어디서 지키나: `hooks/scripts/safety/browser-guard.mjs`

### 18. 무거운 실행은 실행 슬롯 안에서 (`heavy-runs-in-slots`)

- 규칙: 전체 시험, 전체 빌드, 패키지 설치, 브라우저 실행은 `wb-slot` 으로 감싸 실행한다.
- 왜: 무거운 실행이 여러 레인에서 겹치면 머신이 느려진다. 그러면 결함이 없어도 시험이 시간 초과로 실패한다.
- 막혔을 때: 같은 명령을 `wb-slot -- <명령>` 으로 실행한다. 빈 슬롯이 없으면 차례가 올 때까지 기다린다.
- 메시지 코드: `safety.slot.*`
- 관련 설정: `machine.slots`
- 어디서 지키나: `hooks/scripts/slots/slot-guard.mjs`, `bin/wb-slot`

## 모델과 지시서

서브에이전트를 보낼 때 모델과 지시서를 검사한다. Agent 도구를 호출하기 전에 디스패치 검사 훅이 판정한다.

### 19. 작업 종류에 맞는 모델 사용 (`model-routing`)

- 규칙: 서브에이전트는 작업 종류별로 정한 모델로 실행한다. 금지 모델, 대체 순서에 없는 모델, 최소 등급보다 낮은 모델은 쓰지 않는다.
- 왜: 작업마다 필요한 판단 수준이 다르다. 설계나 검수를 낮은 등급 모델에 맡기면 결함을 놓쳐 나중에 고치는 비용이 커진다. 적대 검증은 사슬에서 가장 높은 등급(기본값은 opus)을 먼저 쓰고, 구현 모델과 다른 모델이 있으면 그 모델을 고른다.
- 막혔을 때: `wb-route resolve <작업 종류>` 가 알려 주는 모델로 다시 실행한다. 사용 한도가 소진돼 쓸 모델이 없으면 낮은 등급으로 내리지 않고 한도가 풀릴 때까지 기다린다.
- 메시지 코드: `dispatch.model_*`, `dispatch.below_floor`, `dispatch.off_chain`, `dispatch.no_model`, `dispatch.type_*`, `dispatch.wait`
- 관련 설정: `routing`
- 어디서 지키나: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-route`

### 20. 검수는 구현과 다른 모델로 (`implementer-verifier-differ`)

- 규칙: 검수와 반대 입장 검토는 구현한 모델과 다른 모델로 한다. 다른 모델을 쓸 수 없으면 같은 모델을 새 대화로 실행하고, 그 사실을 보고에 적는다.
- 왜: 같은 모델이 자기 결과를 다시 보면 같은 판단 오류를 되풀이하기 쉽다.
- 막혔을 때: `wb-route explain <작업 종류> --implementer <모델>` 로 쓸 수 있는 모델을 확인해 그 모델로 실행한다.
- 메시지 코드: `dispatch.differ_violation`, `dispatch.same_model`
- 어디서 지키나: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-route`

### 21. 레인은 지시서로 시작 (`brief-required`)

- 규칙: 레인을 시작할 때는 지시서를 쓴다. 지시서에는 표지와 필수 절(목표, 범위, 금지 사항, 시험, 보고, 커밋)이 있어야 한다.
- 왜: 말로만 지시하면 범위와 금지 사항이 빠진다. 그러면 레인이 다른 레인의 파일을 고치거나 보고를 남기지 않는다.
- 막혔을 때: `wb-check brief <파일>` 로 빠진 항목을 확인한다. `templates/briefs/` 의 양식으로 채운 뒤 다시 실행한다.
- 메시지 코드: `dispatch.brief_*`
- 관련 설정: `dispatch.brief`
- 어디서 지키나: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-check`, `templates/briefs/ko/impl.md`

### 22. 동시 레인 수 상한 (`lane-cap`)

- 규칙: 동시에 진행하는 레인은 정한 수(기본 3개)를 넘지 않는다.
- 왜: 레인이 많으면 머신 부하가 올라 시험이 시간 초과로 실패한다. 취합 담당의 검수도 따라가지 못한다.
- 막혔을 때: 끝난 레인을 합치고 작업 폴더를 정리한 뒤 새 레인을 연다. 진행 중인 레인은 `/wb:lanes` 로 확인한다.
- 메시지 코드: `dispatch.lanes_full`, `wt.lanes_full`
- 관련 설정: `machine.lanes.max`
- 어디서 지키나: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-worktree`

### 23. 부하 단계에 따른 레인 조정 (`load-tiers`)

- 규칙: 1분 부하가 가벼운 작업만 허용 문턱 이상이면 무거운 실행(시험·빌드·설치)이 있는 작업 종류의 새 레인을 띄우지 않는다. 새 레인 보류 문턱 이상이면 새 레인을 띄우지 않는다. 무거운 실행 중지 문턱 이상이면 검수 레인의 무거운 실행부터 멈춘다. 이미 잡힌 슬롯의 실행은 멈추지 않는다.
- 왜: 부하가 쌓인 상태에서 레인을 더 띄우면 모든 레인의 시험이 시간 초과로 실패한다. 설계·검수·문서처럼 무거운 실행이 없는 레인은 부하를 거의 늘리지 않으므로 중간 단계에서도 계속 띄울 수 있다. 검수는 실행보다 뒤로 미뤄도 결과가 바뀌지 않는다.
- 막혔을 때: `wb-slot check` 로 부하와 고아 프로세스를 확인한다. 지워진 레인 폴더에 남은 프로세스는 `wb-slot reap --orphans` 로 보고, 확인한 뒤 `--kill` 로 그 PID 만 종료한다. 가벼운 작업만 허용 단계에서는 가벼운 종류(`weight: light`)만 먼저 띄우고, 부하가 내려가면 나머지를 디스패치한다.
- 메시지 코드: `dispatch.load_hold`, `dispatch.load_light_only`, `safety.slot.load_stop_heavy`
- 관련 설정: `machine.load.tiers`, `routing.tasks.*.weight`
- 어디서 지키나: `hooks/scripts/dispatch/dispatch-guard.mjs`, `hooks/scripts/slots/slot-guard.mjs`, `hooks/scripts/load/check.mjs`, `bin/wb-slot`

### 24. 레인은 자기 시험만 실행 (`lane-test-scope`)

- 규칙: 레인은 자기가 만들거나 고친 시험 파일만 실행한다. 전체 시험과 전체 패키지 점검은 취합 담당이 한 번만 실행한다.
- 왜: 레인마다 전체 시험을 돌리면 부하가 겹쳐 시간 초과 실패가 난다. 같은 결과를 여러 번 얻느라 시간도 쓴다.
- 막혔을 때: 지시서의 시험 규칙대로 해당 파일만 실행한다. 전체 시험이 필요하다고 판단되면 보고에 적어 취합 담당에게 넘긴다.
- 메시지 코드: `dispatch.brief_incomplete`, `safety.slot.*`
- 어디서 지키나: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`, `hooks/scripts/slots/slot-guard.mjs`

### 25. 보고는 파일과 응답 두 곳에 (`report-twice`)

- 규칙: 레인은 보고를 파일로 남기고, 같은 내용을 최종 응답으로도 돌려준다. 큰 항목을 끝낼 때마다 중간 기록을 남긴다.
- 왜: 응답이 비어 있거나 작업이 중간에 끊겨도 결과가 남아야 한다.
- 막혔을 때: 지시서의 보고 위치에 지금까지의 내용을 쓰고, 응답에도 요약을 붙인다.
- 메시지 코드: `dispatch.brief_incomplete`
- 어디서 지키나: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`

### 26. 시작 커밋 확인 (`base-commit`)

- 규칙: 레인은 시작할 때 작업 폴더의 현재 커밋이 지시서의 기준 커밋과 같은지 확인한다. 다르면 작업 전에 보고한다.
- 왜: 오래된 기준에서 작업하면 이미 고친 문제를 다시 고치거나 병합 충돌이 커진다.
- 막혔을 때: `git log -1` 결과를 지시서와 비교한다. 다르면 통합 브랜치를 먼저 받아 오거나 취합 담당에게 알린다.
- 메시지 코드: `dispatch.brief_incomplete`
- 어디서 지키나: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`

## 세션과 인계

세션이 끊기거나 한도에 걸려도 작업을 이어받을 수 있게 한다.

### 27. progress.md 로 다음 세션에 인계 (`progress-handoff`)

- 규칙: 세션을 시작하면 `progress.md` 를 처음부터 끝까지 읽는다. 작업 단위가 끝날 때마다 이 파일을 새로 쓴다. 이 파일에는 지금 유효한 상태만 둔다(기본 300줄 이하). 끝난 내용은 `docs/progress-archive/progress-<YYYY-MM>.md` 에 덧붙인다.
- 왜: 이전 대화를 모르는 새 세션은 `progress.md` 만 보고 일을 이어받는다. 내용이 오래되면 끝난 일을 다시 하거나 진행 중인 상태를 놓친다. 이전 기록이 쌓여 파일이 길어지면 새 세션이 앞부분만 읽고 현재 상태를 놓친다.
- 막혔을 때: 끝난 내용을 아카이브에 덧붙인다(`wb-waves handoff archive "<요지>"` 는 지금 파일 전체를 덧붙인다). 그다음 `progress.md` 에 목표와 소유자 결정, 브랜치와 서버, 진행 중, 다음 할 일, 확인 대기, 시스템 지식, 재개 명령을 새로 적고 두 파일을 함께 커밋한다. 파일이 이미 너무 길어졌으면 `wb-waves handoff migrate` 로 통째로 옮긴 뒤 새로 쓴다.
- 관련 설정: `personal.handoff`
- 어디서 지키나: `hooks/scripts/handoff/session-start.mjs`, `hooks/scripts/handoff/stop-guard.mjs`, `skills/pickup/SKILL.md`, `bin/wb-waves`

### 28. 작업 단위마다 기록 커밋 (`wave-checkpoint`)

- 규칙: 웨이브가 끝나면 진행 기록을 커밋하고, 사용자에게 `/clear` 로 대화를 비우라고 안내한다. 레인 브랜치의 작업 중 커밋(체크포인트)은 레인 커밋 정책(`project.lanes.commit`)을 따른다.
- 왜: 대화가 길어지면 사용 한도에 걸려 세션이 멈춘다. 기록을 일찍 남겨 두면 새 세션이 어느 시점에서든 이어받을 수 있다.
- 막혔을 때: `/wb:resume` 으로 재개 보고를 만들고, 오래된 항목부터 정리한다.
- 관련 설정: `project.lanes.commit`
- 어디서 지키나: `hooks/scripts/checkpoint/checkpoint.mjs`, `skills/resume/SKILL.md`

### 29. 사용량 단계별 대응 (`token-stages`)

- 규칙: 사용량이 90%, 95%, 99% 에 이르면 단계별 지침을 따른다. 사용량은 공식 5시간·7일 사용량(조회 이후 분은 로컬 추정을 더한 값) 중 높은 쪽이다. 90% 에서는 작업 단위를 줄인다. 95% 에서는 웨이브마다 인계 기록을 쓴다. 99% 에서는 마지막 인계 기록을 쓴 뒤 기다린다.
- 왜: 한도에 걸려 갑자기 멈추면 기록하지 않은 작업이 사라진다.
- 막혔을 때: 안내가 나오면 진행 중인 단계를 마무리하고 `progress.md` 를 갱신한다. 기준 값은 `/wb:token-guard` 로 바꾼다.
- 관련 설정: `personal.token_guard`
- 어디서 지키나: `hooks/scripts/token-guard/check.mjs`, `skills/token-guard/SKILL.md`

### 30. 자동 재개는 기본 권한으로 (`auto-retry-default-permission`)

- 규칙: 사용 한도로 멈춘 세션을 자동으로 다시 시작할 때는 기본 권한 모드만 쓴다.
- 왜: 아무도 보지 않는 세션이 권한 확인을 건너뛰면 위험한 작업이 확인 없이 실행될 수 있다.
- 막혔을 때: 예약 상태는 `/wb:auto-retry status` 로 확인한다. 권한 모드를 높이려면 사용자가 직접 위험 확인 절차를 거친다.
- 관련 설정: `personal.auto_retry.permission_mode`
- 어디서 지키나: `hooks/scripts/auto-retry/detect.mjs`, `skills/auto-retry/SKILL.md`

### 31. 간결 모드에서도 근거는 유지 (`terse-mode`)

- 규칙: 간결 모드에서는 출력과 도구 호출을 줄인다. 검증 근거와 최종 보고는 줄이지 않는다.
- 왜: 간결 모드의 목적은 토큰 절약이다. 확인하지 않은 결과를 보고해도 된다는 뜻이 아니다.
- 막혔을 때: `/wb:terse off` 로 끈다.
- 어디서 지키나: `hooks/scripts/terse/session-start.mjs`, `skills/terse/SKILL.md`, `rules/terse.ko.md`

### 32. 출력 언어는 설정대로 (`output-language`)

- 규칙: `personal.language` 가 `ko` 나 `en` 이면 사용자에게 보이는 모든 출력을 그 언어로 쓰고, 서브에이전트 지시문에도 보고 언어를 적는다. 코드·경로·명령은 원문 그대로 둔다.
- 왜: 서브에이전트가 다른 언어로 보고하면 메인 세션이 다시 옮겨 써야 하고, 옮기는 과정에서 수치와 근거가 빠진다.
- 막혔을 때: 다른 언어로 쓴 출력은 설정 언어로 다시 쓴다. 이 안내를 끄려면 `personal.session_rules.language` 를 `false` 로 둔다.
- 관련 설정: `personal.session_rules.language`
- 어디서 지키나: `hooks/scripts/rules/session-start.mjs`, `rules/language.ko.md`

### 33. 원격 사용자에게는 아티팩트로 (`remote-viewer`)

- 규칙: `personal.report.viewer` 가 `remote` 이면 `localhost` 주소·로컬 경로·로컬 파일 첨부로 안내하지 않는다. 보여 줄 것은 아티팩트로 올리고, 이미지는 base64 `data:` URI 로 넣으며, 캡처는 2배율로 찍는다.
- 왜: 다른 기기에서 접속한 사용자는 이 머신의 주소와 파일을 열 수 없다. 1배율 캡처는 글자가 뭉개져 화면 차이를 눈으로 확인할 수 없다.
- 막혔을 때: `wb-art report` 로 이미지를 넣은 HTML 을 만들어 아티팩트로 올리고 링크를 준다. 갱신은 같은 파일 경로로 다시 올린다.
- 관련 설정: `personal.report.viewer`, `personal.session_rules.remote`
- 어디서 지키나: `hooks/scripts/rules/session-start.mjs`, `rules/remote-viewer.ko.md`, `bin/wb-art`

### 34. 구현과 반영을 구분해 보고 (`report-accuracy`)

- 규칙: 「기능 구현됨」과 「병합·배포 완료」를 구분해서 보고한다. 병합 뒤에는 영향받는 서버를 재기동·재동기화한 다음에 「반영됐다」고 말한다. 수정 전에는 실제로 돌고 있는 앱과 변형을 확인한다.
- 왜: 코드만 바뀌고 서버가 예전 코드를 돌리고 있으면 사용자는 고쳐지지 않은 화면을 보게 된다. 다른 변형을 고치면 시간을 쓰고도 문제가 그대로 남는다.
- 막혔을 때: 보고에 구현·병합·배포·재기동 상태를 따로 적는다. 서버 목록은 `machine.servers` 에 두고 재기동 뒤 응답을 확인한다.
- 관련 설정: `personal.session_rules.conduct`
- 어디서 지키나: `hooks/scripts/rules/session-start.mjs`, `rules/conduct.ko.md`

### 35. 모호하면 되묻고 반복 질문에 먼저 답함 (`communication`)

- 규칙: 코드·문서 변경인지 운영 조치인지 모호한 요청은 한 번 되묻는다. 같은 질문이 반복되면 다른 작업보다 먼저 그 질문에 답한다. 채팅 응답에도 근거와 수치를 직접 적는다.
- 왜: 운영 조치를 코드 변경으로 받아들이면 필요 없는 수정이 생긴다. 같은 질문이 반복된다는 것은 앞선 답이 전달되지 않았다는 뜻이다.
- 막혔을 때: 되물을 때는 선택지를 두세 개로 좁혀 묻는다. 반복된 질문에는 한 줄 결론부터 답한다.
- 관련 설정: `personal.report.chat_detail`, `personal.session_rules.conduct`
- 어디서 지키나: `hooks/scripts/rules/session-start.mjs`, `rules/conduct.ko.md`

## 품질과 문서

검수·보고·문서가 같은 기준을 따르게 한다. 대부분 명령과 스킬이 안내하며, 일부는 훅이 막는다.

### 36. 기능과 시험은 함께 변경 (`tests-with-change`)

- 규칙: 기능을 추가·수정·삭제할 때는 같은 변경에서 관련 시험도 맞춘다. 지금 고칠 수 없는 결함은 시험 기준을 낮추지 않고, 보류 표시와 결함 기록으로 남긴다.
- 왜: 시험 없는 변경, 지운 기능을 계속 확인하는 시험, 실제 동작과 다른 기대값은 다음 변경에서 문제를 일으킨다.
- 막혔을 때: 지시서의 시험 규칙대로 시험을 고친다. 고칠 수 없는 결함은 `wb-defects add` 로 기록한다.
- 어디서 지키나: `templates/briefs/ko/impl.md`, `bin/wb-defects`, `bin/wb-cases`

### 37. 시험 결과는 엑셀로 저장 (`test-results-workbook`)

- 규칙: 시험 결과는 엑셀 파일로 저장하고 커밋한다. 결과 파일이 없으면 보고를 마칠 수 없다.
- 왜: 「통과했다」는 말만으로는 무엇을 몇 건 확인했는지 나중에 알 수 없다.
- 막혔을 때: `/wb:test-report` 로 결과 파일을 만들고 `wb-check test-results` 로 확인한다.
- 어디서 지키나: `bin/wb-test-report`, `bin/wb-check`, `skills/test-report/SKILL.md`

### 38. 설계는 적대 검증 「높음 0건」 뒤에 구현 (`design-adversarial-review`)

- 규칙: 설계 문서가 나오면 구현 전에 설계를 쓴 쪽과 다른 맥락의 검증자(강한 모델, 읽기 전용)가 적대적으로 검증한다. 검증자는 설계가 인용한 코드 지점을 직접 대조하고, 지적을 높음·중간·낮음으로 나눠 근거 `파일:줄` 과 고칠 방향을 붙이며 마지막 줄에 「높음 N건」을 적는다. 설계는 판(2판·3판…)으로 고치고 판마다 바뀐 문단에 판 표식과 반영 대조표(지적 → 수용·불수용 → 반영 위치, 불수용은 근거)를 두며, 고칠 때마다 다시 검증한다. 높음만 고친 판은 해당 지적과 그 판의 새 위험만 짧게 재검증해도 된다. 「높음 0건」이 되어야 구현에 들어간다. 오너 결정이 필요한 항목은 따로 모아 확인받는다. 화면 설계·시안은 UX 적대 점검의 아홉 축으로 본다. 구현이 끝나면 코드 정독으로 설계 불변식이 지켜졌는지 한 번 더 적대 검증한다.
- 왜: 문장으로는 맞아 보이는 설계도 인용한 코드와 어긋나면 구현 단계에서 되돌림이 생긴다. 설계를 쓴 쪽은 자기 가정을 다시 의심하기 어렵다.
- 막혔을 때: `/wb:design-adversarial` 로 검증자를 띄우고, 높음 지적을 판으로 고친 뒤 다시 검증한다. 불수용은 반영 대조표에 근거를 적는다.
- 어디서 지키나: `skills/design-adversarial/SKILL.md`, `skills/work/SKILL.md`

### 39. 출하 검증 전에 선행 검증 통과 (`ship-precheck`)

- 규칙: 출하 검증은 단위·통합·게이트·e2e·UI 안정성·사용성 등 필수 검증이 모두 현재 커밋에서 통과한 뒤에만 시작한다. 결과가 없거나, 다른 커밋의 것이거나, 실패했으면 먼저 다시 돌려 통과시킨다. 직전 통과 결과보다 시험 수가 줄거나, 건너뜀·보류가 늘거나, 임계값이 완화된 결과는 통과로 보지 않는다. 화면이 있는 제품은 출하 판정 직전에 그 판에서 바뀐 화면을 구현과 다른 맥락의 검증자가 적대적으로 점검한다. 격리 스택에서 페르소나의 실제 과업을 헤드리스로 끝까지 수행하고 2x 캡처를 남기며, 아홉 축(논리적 오류·정보 표기 정합성·사용자 맥락·흐름 맥락·초보 길 잃음·다음 할 일·오류에서 빠져나갈 길·접근성과 좁은 폭·어두운 테마·디자인 시스템 시각 대조)을 모두 본다. 「차단」·「높음」 지적이 남아 있으면 출하하지 않고, 화면을 바꾸는 지적은 모아 오너 확인을 받은 뒤 고친다. 그다음 출하 판정(verifying-production-readiness)을 한다.
- 왜: 출하 판정은 그 커밋의 실제 시험 결과에 기대야 한다. 오래된 결과나 시험을 줄여 얻은 통과는 판정의 근거가 되지 못한다. 레인별 시험과 디자인 린트 기준선은 처음 쓰는 사람이 헷갈리는 문구, 막다른 화면, 붙은 간격·좁은 줄간격 같은 시각 위반을 걸러 내지 못한다.
- 막혔을 때: `/wb:ship-verify` 를 실행한다. `wb-quality precheck --run` 이 빠졌거나 낡았거나 실패한 검증을 돌린다. 실패는 원인을 고친 뒤 다시 돌린다. 약화가 의도한 변경이면 저장소 소유자가 자기 터미널에서 `wb-quality accept` 로 승인한다.
- 메시지 코드: `dispatch.ship_precheck`
- 어디서 지키나: `hooks/scripts/quality/ship-gate.mjs`, `bin/wb-quality`, `skills/ship-verify/SKILL.md`, `skills/quality-ux-adversarial/SKILL.md`

### 40. 번호는 먼저 예약 (`number-reservation`)

- 규칙: 번호가 붙는 파일(데이터베이스 변경 스크립트, 결정 기록 등)은 번호를 먼저 예약한 뒤 만든다.
- 왜: 병렬 레인이 같은 번호를 쓰면 병합 때 충돌하고 번호를 다시 매겨야 한다.
- 막혔을 때: `wb-number reserve <계열> --lane <레인>` 으로 번호를 받는다. 이미 겹쳤으면 나중에 만든 파일의 번호를 바꾼다.
- 관련 설정: `project.numbers`
- 어디서 지키나: `bin/wb-number`, `lib/numbers.mjs`

### 41. 끝난 작업 폴더 정리 (`worktree-cleanup`)

- 규칙: 끝난 레인의 작업 폴더(워크트리)는 대상 브랜치에 병합한 뒤 지운다. 지우기 전에 그 폴더에서 시작한 프로세스를 PID 로 먼저 종료한다.
- 왜: 남은 작업 폴더의 프로세스가 계속 CPU 를 쓴다. 남은 폴더에서 작업이 이어지면 인계 기록도 두 갈래로 나뉜다.
- 막혔을 때: `wb-reap` 으로 정리할 대상을 확인하고 `wb-worktree remove <레인>` 으로 지운다.
- 어디서 지키나: `bin/wb-worktree`, `bin/wb-reap`, `skills/resume/SKILL.md`

### 42. 소유자 결정은 문서로 (`owner-decisions-recorded`)

- 규칙: 소유자가 정한 사항은 결정 기록(`docs/decisions/`)으로 남긴다.
- 왜: 대화로만 정한 사항은 다음 세션이 알 수 없어 같은 질문을 다시 하게 된다.
- 막혔을 때: `/wb:decide` 로 질문을 정리해 답을 받고 결정 기록을 만든다.
- 관련 설정: `project.paths.decisions`
- 어디서 지키나: `skills/decide/SKILL.md`, `bin/wb-decide`

### 43. 파일 종류별 문체 (`style-per-file`)

- 규칙: 문서와 화면 문구는 파일 종류마다 정한 문체(`style.map`)로 쓴다. 보고서체 문서에는 작성 흔적, 과장·비유, 근거 없는 판단, 개발자 용어를 남기지 않고 마지막 점검 세 질문으로 확인한다.
- 왜: 화면 문구와 보고서의 문체를 구분하지 않으면 같은 제품 안에서 문구의 인상이 제각각이 된다.
- 막혔을 때: `wb-style of <파일>` 로 그 파일의 문체를 확인하고, `wb-style rules <문체>` 의 규칙대로 고친다.
- 관련 설정: `project.style.map`
- 어디서 지키나: `skills/writing-style/SKILL.md`, `bin/wb-style`, `templates/briefs/ko/docs.md`

### 44. 화면 구조 변경은 시안 먼저 (`mockup-first`)

- 규칙: 화면 구조를 바꾸는 작업은 구현 전에 시안을 보여 주고 결정을 받는다.
- 왜: 구현한 뒤에 구조가 반려되면 작업을 처음부터 다시 해야 한다.
- 막혔을 때: 시안을 아티팩트로 보여 준다. `wb-decide new <이름> --kind mockup --scope <경로>` 로 결정 문서를 만들고, 선택을 `wb-decide answer` 로 기록해 커밋한다. 결정 문서의 scope 는 고치려는 파일을 포함해야 한다.
- 메시지 코드: `mockup.*`
- 관련 설정: `project.mockup`
- 어디서 지키나: `hooks/scripts/mockup/mockup-first.mjs`, `bin/wb-decide`

### 45. 끝난 작업은 아티팩트로 보고 (`report-artifact`)

- 규칙: `/wb:report` 로 보고할 때는 결과를 아티팩트로 올린다. 시험 결과 엑셀을 쓰는 프로젝트는 최신 결과 파일도 확인한다.
- 왜: 말로만 한 보고는 다른 곳에서 확인할 수 없고, 캡처나 수치 같은 근거도 남지 않는다.
- 막혔을 때: 아티팩트 도구로 보고를 올린다. 아티팩트를 쓸 수 없으면 `wb-art report` 로 이미지를 넣은 HTML 파일을 만든다. 이 검사를 끄려면 `personal.report.artifact_check` 를 `false` 로 둔다.
- 메시지 코드: `artifact.*`
- 관련 설정: `personal.report.artifact_check`
- 어디서 지키나: `hooks/scripts/report/artifact-check.mjs`, `bin/wb-art`, `skills/report/SKILL.md`

### 46. 코드 흐름은 코드 색인으로 확인 (`codegraph-first`)

- 규칙: 흐름, 호출하는 곳, 변경 영향은 코드 색인(codegraph)으로 확인한다. 정확한 줄 번호와 문자열은 텍스트 검색으로 확인한다.
- 왜: 호출하는 곳을 텍스트 검색으로 하나씩 따라가면 검색 횟수가 늘어난다. 색인에는 줄 번호와 일부 호출 관계가 없으므로 텍스트 검색은 막지 않는다.
- 막혔을 때: 안내가 나오면 같은 질문을 `codegraph_callers` 나 `codegraph_explore` 로 한 번 해 본다. 안내를 끄려면 `project.codegraph.nudge` 를 `off` 로 둔다.
- 관련 설정: `project.codegraph.nudge`
- 어디서 지키나: `hooks/scripts/codegraph/nudge.mjs`, `hooks/scripts/codegraph/session-start.mjs`

### 47. 색인 없는 경로는 다시 조회하지 않음 (`codegraph-index-first`)

- 규칙: 색인이 없는 경로로 codegraph 를 다시 호출하지 않는다. 새 작업 폴더는 만들 때 색인 대기열에 넣는다.
- 왜: 색인 도구 오류는 대부분 새로 만든 작업 폴더에 색인이 없어서 생겼다. 같은 경로로 다시 호출해도 비용만 늘었다.
- 막혔을 때: grep 과 Read 로 계속 진행한다. 색인 진행은 `wb-index status` 로 보고, 색인이 생기면 같은 세션에서도 다시 호출할 수 있다. 직접 넣으려면 `wb-index add <경로>` 를 쓴다.
- 메시지 코드: `safety.codegraph.*`
- 관련 설정: `project.codegraph.auto_index`
- 어디서 지키나: `hooks/scripts/codegraph/deadpath.mjs`, `hooks/scripts/codegraph/record.mjs`, `bin/wb-index`

### 48. 텍스트 검색은 rg (`rg-search`)

- 규칙: 재귀 텍스트 검색은 `grep -r` 대신 `rg` 로 한다. 한글 주석이 많은 소스는 `rg -a` 로 찾는다. 막지는 않고 안내만 한다.
- 왜: `grep -r` 은 node_modules 와 빌드 결과까지 훑어 느리고 결과가 섞인다. 한글 소스는 grep 이 바이너리로 오인해 결과를 빠뜨린다.
- 막혔을 때: 같은 검색을 `rg` 로 다시 한다. rg 가 없으면 `brew install ripgrep` 으로 설치한다. 안내를 끄려면 `personal.search.rg_hint` 를 `false` 로 둔다.
- 관련 설정: `personal.search.rg_hint`
- 어디서 지키나: `hooks/scripts/codegraph/nudge.mjs`, `lib/search.mjs`

### 49. 임시방편 대신 근본 원인 수정 (`root-cause-fix`)

- 규칙: 임시방편이나 우회로 증상만 가리지 않고 근본 원인을 고친다. 지금 고칠 수 없으면 그 사실과 이유를 보고한다.
- 왜: 우회로 막은 결함은 다른 조건에서 다시 나타나고, 그때는 원래 원인을 찾기가 더 어렵다.
- 막혔을 때: 원인을 재현하는 시험을 먼저 쓰고, 그 시험이 통과하도록 고친다. 고치지 못한 결함은 결함 원장에 남긴다(`wb-defects`).
- 관련 설정: `personal.session_rules.conduct`
- 어디서 지키나: `hooks/scripts/rules/session-start.mjs`, `rules/conduct.ko.md`

### 50. 제품 화면에 이모지 금지 (`no-emoji-ui`)

- 규칙: 제품 화면에는 이모지를 쓰지 않는다. 아이콘이 필요하면 아이콘 리소스(SVG 등)를 쓴다.
- 왜: 이모지는 운영체제와 글꼴마다 모양과 크기가 달라 같은 화면이 기기마다 다르게 보인다.
- 막혔을 때: 이모지를 프로젝트의 아이콘 리소스로 바꾼다. 화면 구조까지 바뀌면 시안부터 만든다.
- 관련 설정: `personal.session_rules.conduct`
- 어디서 지키나: `hooks/scripts/rules/session-start.mjs`, `rules/conduct.ko.md`

### 51. 색인 도구가 없으면 설치하고 계속 (`codegraph-install`)

- 규칙: codegraph 가 설치되어 있지 않으면 사용자에게 묻고 멈추지 않고 설치·초기화한 뒤 계속한다. 워크트리에서 질의할 때는 `projectPath` 에 그 워크트리 경로를 넘긴다.
- 왜: 색인 없이 텍스트 검색만으로 호출 흐름을 따라가면 검색 횟수가 크게 늘어난다. `projectPath` 를 빼면 워크트리 질의가 빈 결과를 돌려준다.
- 막혔을 때: `brew install codegraph` 로 설치하고 `wb-slot` 안에서 `codegraph init .` 를 실행한다. 설치할 수 없는 환경이면 grep 과 Read 로 진행하고 이유를 보고한다.
- 관련 설정: `project.codegraph.nudge`
- 어디서 지키나: `hooks/scripts/codegraph/session-start.mjs`, `rules/codegraph-install.ko.md`

## 추가 예정

카탈로그에 있지만 아직 지키는 장치가 없는 규칙이다.

### 52. 화면 낱말은 용어 사전대로 (`glossary-terms`)

- 규칙: 화면 문구의 낱말은 프로젝트 용어 사전을 따른다.
- 왜: 같은 개념을 화면마다 다른 말로 부르면 사용자가 헷갈린다.
- 막혔을 때: 사전 검사가 추가되기 전에는 `style.map` 의 해요체 규칙과 기존 화면에서 쓰는 낱말을 따른다.
- 어디서 지키나: 아직 없음(이후 판에서 추가)
