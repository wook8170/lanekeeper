# 보안 정책

[English](SECURITY.en.md)

## 취약점 신고

취약점은 공개 이슈로 올리지 말고 `SECURITY_CONTACT_PLACEHOLDER` 로 알려 주기 바란다. 받은 날부터 7일 안에 접수 여부를 회신하고, 수정 일정은 영향 범위를 확인한 뒤 정한다. 지원 대상은 가장 최근 0.x 판이다.

## 보호 범위

wb 의 안전 훅은 에이전트가 실수로 위험한 명령을 실행하는 것을 막는 장치다. 같은 머신에서 악의적으로 동작하는 프로그램을 막는 보안 경계가 아니다.

- 안전 훅은 Bash 명령 문자열과 Write·Edit 대상 경로를 판정한다. 스크립트 파일 안의 명령, python·node 에서 실행하는 git·kill 호출, `find -delete`, `git checkout -- .` 같은 일괄 되돌리기는 판정하지 않는다.
- 소유자 허가(`/wb:approve`)는 사람이 프롬프트에 입력할 때만 만들어진다. 허가 파일은 `<git 공용 폴더>/wb/owner-grant.json` 에 있고 정해진 시간(기본 15분) 안에 한 번, 지정한 커밋에만 쓸 수 있다. 같은 머신의 다른 프로세스가 이 파일을 직접 쓰는 경우는 막지 못한다. 에이전트의 Write·Edit 와 Bash 명령에서 이 경로를 언급하는 경우는 막지만, 경로를 조립해 쓰는 스크립트까지 막지는 못한다.
- 훅 명령이 아예 실행되지 않으면(node 미설치, 시간 초과 20초) Claude Code 는 이를 차단하지 않는 오류로 처리한다. 이때는 안전 훅도 동작하지 않는다. `/wb:doctor` 가 node 설치를 확인한다.

## 훅이 실패할 때

안전 훅은 판정하지 못하면 막고, 나머지 훅은 오류가 나도 작업을 막지 않는다. `tests/l14-security.test.mjs` 가 모든 훅에 깨진 입력과 깨진 설정을 넣어 이 동작을 확인한다.

| 훅 | 이벤트 | 오류·설정 오류 때 |
|---|---|---|
| `safety/pretool` | PreToolUse(Bash·Write·Edit·MultiEdit·NotebookEdit·Skill) | 도구 호출을 거부한다. 설정 파일 오류는 판정 대상 명령을 모두 막는다 |
| `safety/approve` | UserPromptExpansion(`/wb:approve`) | 허가를 만들지 않고 입력을 막는다 |
| `dispatch/dispatch-guard` | PreToolUse(Agent·Task) | 통과시키고 안내만 남긴다 |
| `slots/slot-guard`, `mockup/mockup-first`, `codegraph/nudge`, `codegraph/deadpath` | PreToolUse | 통과시킨다 |
| `handoff/session-start`, `auto-retry/session-start`, `terse/session-start`, `worktree/session-sync`, `codegraph/session-start` | SessionStart | 아무것도 넣지 않는다 |
| `token-guard/check`, `codegraph/record` | UserPromptSubmit · PostToolUse | 아무것도 하지 않는다 |
| `handoff/stop-guard`, `auto-retry/detect`, `report/artifact-check` | Stop · StopFailure | 세션 종료를 막지 않는다 |
| `checkpoint/checkpoint`, `ledger/subagent` | SubagentStart · SubagentStop · StopFailure · PreCompact | 커밋·기록을 건너뛴다 |

## 외부 명령 실행

훅과 `wb-*` 명령은 셸을 거치지 않고 인자 목록으로 외부 프로그램을 실행한다. 실행하는 프로그램은 `git`, `gh`(PR 대상 확인), `lsof`, `ps`, `codegraph`, `sqlite3`, `nice`, `osascript`·`notify-send`(알림), `launchctl`·`systemd-run`·`systemctl`(자동 재개 예약), `claude`(자동 재개), `python3`(엑셀 생성), `cwebp`(이미지 변환)다.

셸(`sh -c`)로 실행하는 곳은 아래 네 곳뿐이다. 모두 사용자나 프로젝트 설정이 적은 명령이므로, 그 명령을 직접 실행하는 것과 같은 권한으로 돈다. 다른 사람의 저장소를 열 때는 `.wb/config.json` 과 `.wb/verify.config.json` 의 명령을 먼저 확인한다.

| 위치 | 실행하는 명령 |
|---|---|
| `bin/wb-slot` | 사용자가 `wb-slot -- <명령>` 으로 감싼 명령 |
| `lib/review.mjs` | `project.review.guards` |
| `lib/worktree.mjs` | `project.worktree.setup` |
| `templates/test-results/project/run-gate.mjs` | `.wb/verify.config.json` 의 게이트 단계 |

새 셸 실행 지점이 생기면 `tests/l14-security.test.mjs` 의 허용 목록 시험이 실패한다. 추가하려면 보안 검토를 거쳐 목록을 고친다.

## 입력 검사

| 입력 | 검사 |
|---|---|
| 아티팩트 슬러그(`wb-art --slug`) | 글자·숫자·한글·`.`·`_`·`-` 만 허용, `..` 금지 |
| 레인 이름(`wb-check lane`, 되돌림 지시서) | 영문·숫자·`.`·`_`·`-` 64자 이하 |
| 결정 문서 이름(`wb-decide`) | 글자·숫자·한글·`_`·`-` 61자 이하 |
| 세션 ID(파일 이름에 쓰일 때) | 영문·숫자·`_`·`-` 이외 문자는 `_` 로 바꾼다 |
| 화면 확인 주소(`wb-check lane --serve-url`) | `localhost`·`127.0.0.0/8`·`[::1]` 만 허용 |
| 색인 복사 경로(`sqlite3 .backup`) | 따옴표·제어 문자가 있으면 `sqlite3` 대신 파일 복사 |

## 네트워크

훅과 명령은 외부로 데이터를 보내지 않는다. 사용 지표와 기록은 로컬 파일에만 둔다. 예외는 두 가지다.

- 안전 훅은 `gh pr merge` 를 판정할 때 대상 브랜치를 알기 위해 `gh pr view` 를 실행한다(8초 제한). `gh` 가 설정된 GitHub 계정으로 조회하며, 확인하지 못하면 병합을 막는다.
- 검수 9항목의 화면 확인은 로컬 개발 서버 주소 하나를 읽는다. 이 머신 밖의 주소는 거부한다.

## 읽는 파일과 남기는 파일

| 기능 | 읽는 것 | 남기는 것 |
|---|---|---|
| 토큰 가드 | `~/.claude/projects` 아래에서 최근 구간에 바뀐 대화 기록의 토큰 사용량 필드. 예산(`token_guard.budget`)을 정하기 전에는 읽지 않는다 | `${CLAUDE_PLUGIN_DATA}/token-guard/` 에 합계 수치 |
| 자동 재개 | 현재 세션 기록의 끝부분(한도 문구·모델 이름) | `${CLAUDE_PLUGIN_DATA}` 에 예약 상태, 재개한 세션의 출력 로그(본인만 읽기 권한) |
| 레인 원장 | 서브에이전트 기록의 모델 이름과 토큰 사용량 | `<git 공용 폴더>/wb/` 에 레인별 횟수·모델·토큰·지시서 해시 |
| 보고 확인 | 현재 세션 기록의 도구 호출 이름 | 세션별 차단 표시 한 줄 |
| codegraph 기록 | codegraph 응답의 성공·실패 구분 | `.wb/metrics/codegraph.jsonl` 에 분류와 시각 |
| 체크포인트 | git 상태 | 레인 브랜치의 임시 커밋. 추적 중인 파일만 넣고 `.env*`·`*.pem`·`*.key`·`id_*`·`*credentials*`·`*.p12` 는 빼고 알린다 |

대화 본문은 저장하지 않는다. 비밀값과 환경 변수는 로그에 쓰지 않는다(`tests/l14-security.test.mjs` 가 환경 변수 출력 코드를 검사한다).

## 무인 재개 권한

자동 재개는 기본 권한 모드(`default`)로 실행한다. `bypassPermissions` 는 `wb-retry mode bypassPermissions --i-understand` 로 위험을 확인한 기록이 있을 때만 쓰이고, 기록이 없으면 `default` 로 내려 실행한다. 자격 증명은 저장하지 않는다.

## 함께 쓰는 도구의 라이선스

wb 는 아래 도구를 포함하지 않고 설치 방법만 안내한다.

| 도구 | 쓰는 곳 | 라이선스 |
|---|---|---|
| codegraph(`@colbymchenry/codegraph`) | 코드 색인 | MIT(npm 패키지 정보 기준) |
| openpyxl | 시험 결과 엑셀 | MIT |
| Pillow | PNG → WebP 변환(선택) | MIT-CMU |
| cwebp(libwebp) | PNG → WebP 변환(선택) | BSD-3-Clause |
| Playwright | 화면 시험(프로젝트가 설치) | Apache-2.0 |

codegraph 는 `/wb:init` 에서 사용자가 동의한 경우에만 설치한다.

## 공개 전 점검

- 비밀값 검사: `gitleaks git .` 와 `gitleaks dir .`
- 내부 정보 검사: `npm test` 의 저장소 검사(사설 IP·메일 주소·홈 폴더·프로젝트 고유 문자열). 고객명 목록은 공개 저장소에 두지 않고 관리자 머신에서 따로 검사한다.
