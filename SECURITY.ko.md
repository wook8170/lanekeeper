<!-- LANG-SWITCH -->
[English](SECURITY.md) · **한국어**

# 보안 정책

## 취약점 신고

취약점은 공개 이슈로 올리지 말고 `wook81701@gmail.com` 로 알려 주기 바란다. 받은 날부터 7일 안에 접수 여부를 회신하고, 수정 일정은 영향 범위를 확인한 뒤 정한다. 지원 대상은 가장 최근 0.x 판이다.

## 보호 범위

Lanekeeper 의 안전 훅은 에이전트가 실수로 위험한 명령을 실행하는 것을 막는 장치다. 같은 머신에서 악의적으로 동작하는 프로그램을 막는 보안 경계가 아니다.

- 이 훅은 명령의 글자를 읽어 판정하는 로컬 방어선이다. 다른 경로로 실행하면 판정이 일어나지 않으므로, 서버 쪽 브랜치 보호를 대신하지 않는다. 중요한 저장소는 서버의 브랜치 보호를 함께 설정한다.
- 안전 훅은 Bash 명령 문자열과 Write·Edit 대상 경로를 판정한다. 스크립트 파일 안의 명령, python·node 에서 실행하는 git·kill 호출, `find -delete`, `git checkout -- .` 같은 일괄 되돌리기는 판정하지 않는다.
- 소유자 허가는 두 경로로 만들어진다. 사람이 프롬프트에 `/lanekeeper:approve` 를 입력하거나, 메인 세션에서 `lanekeeper-grant` 가 띄운 확인 창에서 허용하는 경우다. 확인 창은 허용한 쪽이 사람인지 증명하지 못하고, 이 한계는 `main` 에 반영하는 허가에도 적용된다. 허가 파일은 `<git 공용 폴더>/lanekeeper/owner-grant.json` 에 있다. 허가는 정해진 시간(기본 15분) 안에 한 번, 지정한 커밋에만 쓸 수 있다. 같은 머신의 다른 프로세스가 이 파일을 직접 쓰는 경우는 막지 못한다. 에이전트의 Write·Edit 와 Bash 명령에서 이 경로를 언급하는 경우는 막지만, 경로를 조립해 쓰는 스크립트까지 막지는 못한다.
- `merge-pr` 허가와 그 표 · 결정 기록은 저장소 밖 `~/.lanekeeper/owner/` 에 둔다. 저장소 · PR · 머리 커밋 · 대상 브랜치에 묶이고, 15분 · 1회다. 표 파일이 한 벌이라 다른 세션이 창을 띄우면 먼저 뜬 창의 표는 무효가 되고, 허용해도 허가가 생기지 않아 다시 띄워야 한다. 허가 파일도 한 벌이라 새 허가가 쓰지 않은 허가를 덮어쓴다.
- 이 폴더의 쓰기 보호는 적어 둔 형태만 막는다. 같은 사용자로 도는 프로그램을 파일 권한으로 완전히 막을 수는 없기 때문이다. 막는 형태: 파일 도구, 폴더 이름을 적은 명령(대소문자 무시, 글로브 · 중괄호 · 변수에 담은 경로 포함), `~/.lanekeeper` 안에서 실행한 쓰기 명령, 그 상위 폴더(`~` 등)로 향한 `cp -R` · `mv` · `rsync` · `ditto` · `tar` · `unzip` · `ln`, 이 경로로 향한 `git clone`. 다만 원본이 끝에 슬래시 없는 일반 이름이면 `mv a ~/` · `cp -R dist ~/` 처럼 그 이름 그대로 놓이므로 통과한다. 이름이 허가 폴더로 가는 다음 단계와 같거나, 경로 안에 `.lanekeeper` 가 있으면 거부한다. `~/*.tmp` 처럼 글로브가 허가 폴더로 가는 경로와 맞을 수 없는 낱말도 통과한다. 막지 못하는 형태: 경로를 조립하는 스크립트(`python3`, `node`), 변수로 폴더를 옮긴 뒤의 쓰기(`cd "$X"`), `cpio` · `pax` 같은 목록 밖 도구, 먼저 만들어 둔 링크를 거치는 경로. `.git/hooks` · `.git/config` 판정은 지금도 대소문자를 구분한다.
- 허가를 쓰는 병합은 `gh pr merge <번호> --repo <호스트/소유자/이름> --match-head-commit <머리> [--squash|--merge|--rebase|-d]` 한 줄만 받는다. 앞뒤에 환경 변수 · `cd` · 다른 명령 · 리디렉션 · 감싸는 명령이 있거나, `--admin` · `--auto` 가 있으면 거부한다. 그래서 판정한 PR 과 병합되는 PR 이 같고, 판정 뒤 머리가 움직이면 GitHub 가 병합을 거부한다. 판정 뒤 PR 의 대상 브랜치를 바꾸는 경우는 이 줄로 막지 못한다. 허가가 필요 없는 병합도 번호와 전체 저장소 이름을 적어야 실행된다. 다만 `gh pr merge [번호] [--repo 이름] [방식] [-d]` 만 있는 줄은 훅이 조회한 번호 · 저장소 · 머리를 적은 줄로 바꿔 실행한다. 이 경우에도 권한 규칙과 확인은 바뀐 줄에 그대로 적용된다(Claude Code 2.1.319 실측). 한 줄에 다른 것이 함께 있으면 바꾸지 않고 거부한다. `merge-main` 허가는 `gh pr merge` 에 쓰이지 않는다.
- 세션 폴더의 저장소가 아닌 PR 은 대상 브랜치와 상관없이 허가를 요구한다. 그 저장소의 보호 목록을 이 폴더에서 읽을 수 없기 때문이다. 세션 폴더의 저장소인지는 `git remote -v` 의 주소로 정하므로, `git remote add` 로 주소를 더하면 같은 저장소로 본다.
- `gh` 는 허용 목록으로 판정한다. 알려진 하위 명령이 아닌 낱말, 하위 명령 앞의 `-R` · `--repo` 밖 옵션, 앞부분의 변수, `gh alias set|import`, `gh extension install|upgrade|create|exec`, `gh repo sync --force` 를 거부한다. `gh api` 는 변수가 있거나 모르는 옵션이 있으면 거부하고, 쓰기 호출의 대상이 병합 · `git/refs` · `contents` · 브랜치 이름 변경 · 브랜치 보호 · `rulesets` 면 거부한다. graphql 은 줄에 적힌 `query` 만 받고 `mutation` 이나 파일 입력은 거부한다. `curl` 은 줄에 주소와 쓰기 옵션이 글자로 있을 때만 같은 기준으로 거부한다. 막지 못하는 형태: 세션 셸에 미리 정의한 `gh` 함수 · 별칭과 `PATH` 변경, 변수에 담은 `curl` 주소, `wget` 과 다른 HTTP 도구, `hub` 같은 다른 프로그램, `gh workflow run` 으로 실행한 작업, `gh repo edit` · `gh repo delete` 같은 저장소 관리 명령.
- 위 내용 때문에 이 훅만으로 보호 브랜치를 지킬 수 없다. 사람 검토가 꼭 필요한 저장소는 서버의 브랜치 보호를 켜고, 병합 권한이 있는 토큰을 에이전트 세션과 나눈다.
- 허가를 쓴 줄이 오류로 끝나면 변경이 일어나지 않은 것으로 보고 허가를 쓰지 않은 상태로 되돌린다. 그래서 커밋 전 훅 실패나 PR 검사 대기 뒤에 같은 줄을 다시 실행하면 창이 다시 뜨지 않는다. 되돌리는 것은 `git` 이나 `gh` 하나만 있는 바로 그 줄뿐이며, 머리 커밋 · 대상 · 시간 제한은 그대로다. 이 훅은 허가를 새로 만들지 않고, 되돌릴 때마다 결정 기록에 `grant-restored` 를 남긴다.
- `commit-main` 허가는 판정 순간의 스테이지 내용과 대조한다. 그래서 판정 뒤 다른 프로세스가 스테이지를 바꾸는 경우는 막지 못한다.
- 저장소에 이미 있는 `pre-commit` 훅이 커밋 중에 스테이지를 바꾸면, 허가와 다른 내용이 커밋된다. 안전 훅은 이 경우를 막지 못하고 커밋 뒤 내용도 대조하지 않는다. 에이전트가 새로 훅을 심는 경로 중 찾은 형태는 따로 다룬다. 같은 줄의 `core.hooksPath` · `core.fsmonitor` · `GIT_CONFIG_*` 지정은 보호 브랜치 커밋 · push · 병합에서 거부한다. 다음은 확인 창으로 묻는다: `.git/hooks/*` · `.git/config` 쓰기, `git config core.hooksPath`, `git init --template` · `GIT_TEMPLATE_DIR` · `init.templateDir`, `.git/` 를 대상으로 한 `cp` · `mv` · `rsync` · `install` · `ln` · `tar` · `unzip`, 읽기만 하는 것으로 정해 둔 명령 밖에서 `.git/config` · `.git/hooks` · `.gitconfig` 를 적은 명령, `.git/` 안에서 실행한 그런 명령, 단독 `export` · `declare -x` · `typeset -x` 로 내보낸 `GIT_CONFIG_*` · `GIT_DIR` · `GIT_INDEX_FILE` · `GIT_WORK_TREE`, `git config remote.<이름>.push` · `remote.<이름>.mirror` 쓰기, `git remote add --mirror`. 그 창을 허용하면 이후 커밋에 그 훅이 적용된다. `.git/` 만 적고 쓰는 경우(`ditto hooks .git`), `awk` · `sed` 프로그램 안의 쓰기, 경로를 조립해 쓰는 스크립트는 막지 못한다.
- `echo ... > .git/refs/heads/main` 같은 ref 파일 직접 쓰기는 판정하지 않는다. 로컬 브랜치만 옮겨지고, push 는 허가의 커밋 대조로 막힌다.
- 명령을 감싸는 도구는 정해진 목록만 푼다. `coproc`, `find -exec` · `-execdir` · `-ok`, `flock`, `ssh-agent`, `setsid`, `script`, `watch`, `gtimeout`, `ionice`, `arch` 는 안의 명령을 판정한다. `parallel` 과, 내용을 읽을 수 없는 입력을 셸에 넘기는 형태(`cat a | sh`, `sh < 파일`)는 `shell.unresolved` 로 거부한다. 목록에 없는 감싸기 명령(`su -c`, `busybox sh`, `make` 등)과 `source <(...)` 안의 명령은 판정하지 못한다.
- 안전 훅(`safety/pretool`)·디스패치 가드·출하 관문 훅에는 `"onFailure": "block"` 을 지정했다. 훅이 실행되지 않거나(node 미설치) 시간 초과(20초)·비정상 종료하면 Claude Code 2.1.295 이상은 그 도구 호출을 막는다. 그보다 낮은 판은 이 필드를 모르므로 같은 상황을 차단하지 않는 오류로 처리한다. 그래서 이때는 안전 훅도 동작하지 않는다. `/lanekeeper:doctor` 가 node 설치를 확인한다.
- 안전 훅(`safety/pretool`, `safety/approve`)은 모든 저장소에서 돈다. 그 밖의 작업 훅은 `.lanekeeper/config.json` 이 있는 저장소에서만 동작한다(`LANEKEEPER_ACTIVE=1` 이면 모든 저장소).

## 훅이 실패할 때

안전 훅은 판정하지 못하면 막고, 나머지 훅은 오류가 나도 작업을 막지 않는다. `tests/l14-security.test.mjs` 가 모든 훅에 깨진 입력과 깨진 설정을 넣어 이 동작을 확인한다.

| 훅 | 이벤트 | 오류·설정 오류 때 |
|---|---|---|
| `safety/pretool` | PreToolUse(Bash·Write·Edit·MultiEdit·NotebookEdit·Skill) | 도구 호출을 거부한다. 설정 파일 오류는 판정 대상 명령을 모두 막는다 |
| `safety/approve` | UserPromptExpansion(`/lanekeeper:approve`) | 허가를 만들지 않고 입력을 막는다 |
| `dispatch/dispatch-guard` | PreToolUse(Agent·Task) | 통과시키고 안내만 남긴다 |
| `slots/slot-guard`, `mockup/mockup-first`, `codegraph/nudge`, `codegraph/deadpath` | PreToolUse | 통과시킨다 |
| `handoff/session-start`, `auto-retry/session-start`, `terse/session-start`, `worktree/session-sync`, `codegraph/session-start` | SessionStart | 아무것도 넣지 않는다 |
| `token-guard/check`, `codegraph/record` | UserPromptSubmit · PostToolUse | 아무것도 하지 않는다 |
| `handoff/stop-guard`, `auto-retry/detect`, `report/artifact-check` | Stop · StopFailure | 세션 종료를 막지 않는다 |
| `checkpoint/checkpoint`, `ledger/subagent` | SubagentStart · SubagentStop · StopFailure · PreCompact | 커밋·기록을 건너뛴다 |

## 외부 명령 실행

훅과 `lanekeeper-*` 명령은 셸을 거치지 않고 인자 목록으로 외부 프로그램을 실행한다. 실행하는 프로그램은 `git`, `gh`(PR 대상 확인), `lsof`, `ps`, `codegraph`, `sqlite3`, `nice`, `osascript`·`notify-send`(알림), `launchctl`·`systemd-run`·`systemctl`(자동 재개 예약), `claude`(자동 재개), `python3`(엑셀 생성), `cwebp`(이미지 변환)다.

셸(`sh -c`)로 실행하는 곳은 아래 네 곳뿐이다. 모두 사용자나 프로젝트 설정이 적은 명령이므로, 그 명령을 직접 실행하는 것과 같은 권한으로 돈다. 다른 사람의 저장소를 열 때는 `.lanekeeper/config.json` 과 `.lanekeeper/verify.config.json` 의 명령을 먼저 확인한다.

| 위치 | 실행하는 명령 |
|---|---|
| `bin/lanekeeper-slot` | 사용자가 `lanekeeper-slot -- <명령>` 으로 감싼 명령 |
| `lib/review.mjs` | `project.review.guards` |
| `lib/worktree.mjs` | `project.worktree.setup` |
| `templates/test-results/project/run-gate.mjs` | `.lanekeeper/verify.config.json` 의 게이트 단계 |

새 셸 실행 지점이 생기면 `tests/l14-security.test.mjs` 의 허용 목록 시험이 실패한다. 추가하려면 보안 검토를 거쳐 목록을 고친다.

## 입력 검사

| 입력 | 검사 |
|---|---|
| 아티팩트 슬러그(`lanekeeper-art --slug`) | 글자·숫자·한글·`.`·`_`·`-` 만 허용, `..` 금지 |
| 레인 이름(`lanekeeper-check lane`, 되돌림 지시서) | 영문·숫자·`.`·`_`·`-` 64자 이하 |
| 결정 문서 이름(`lanekeeper-decide`) | 글자·숫자·한글·`_`·`-` 61자 이하 |
| 세션 ID(파일 이름에 쓰일 때) | 영문·숫자·`_`·`-` 이외 문자는 `_` 로 바꾼다 |
| 화면 확인 주소(`lanekeeper-check lane --serve-url`) | `localhost`·`127.0.0.0/8`·`[::1]` 만 허용 |
| 색인 복사 경로(`sqlite3 .backup`) | 따옴표·제어 문자가 있으면 `sqlite3` 대신 파일 복사 |

## 네트워크

훅과 명령은 외부로 데이터를 보내지 않는다. 사용 지표와 기록은 로컬 파일에만 둔다. 예외는 두 가지다.

- 안전 훅은 `gh pr merge` 를 판정하거나 `merge-pr` 허가를 만들 때 저장소 · PR · 머리 커밋 · 대상 브랜치를 알기 위해 `gh pr view` 를 실행한다(8초 제한). 조회에는 `gh` 에 설정된 GitHub 계정을 쓴다. 대상 브랜치를 확인하지 못하면 병합을 막는다.
- 검수 9항목의 화면 확인은 로컬 개발 서버 주소 하나를 읽는다. 이 머신 밖의 주소는 거부한다.

## 읽는 파일과 남기는 파일

| 기능 | 읽는 것 | 남기는 것 |
|---|---|---|
| 토큰 가드 | `~/.claude.json` 의 공식 사용량 항목(`cachedUsageUtilization`)과 계정 ID(`oauthAccount.accountUuid`). 다른 항목과 인증 정보는 읽지 않는다. `~/.claude/projects` 아래에서 최근 구간에 바뀐 대화 기록의 토큰 사용량 필드와 사용 한도 거절 기록. 훅은 공식 사용량도 예산(`token_guard.budget`)도 없으면 대화 기록을 읽지 않는다. 사람이 `lanekeeper-token status`·`lanekeeper-token calibrate` 를 실행하면 예산과 관계없이 사용량을 보여 주려고 읽는다 | `${CLAUDE_PLUGIN_DATA}/token-guard/` 에 합계 수치, 공식·수동 사용량 기록(`official-history.jsonl`: 시각·계정 ID·비율·리셋 시각), 계정별 보정 계수(`calib-<계정>.json`) |
| 자동 재개 | 현재 세션 기록의 끝부분(한도 문구·모델 이름) | `${CLAUDE_PLUGIN_DATA}` 에 예약 상태, 재개한 세션의 출력 로그(본인만 읽기 권한) |
| 레인 원장 | 서브에이전트 기록의 모델 이름과 토큰 사용량 | `<git 공용 폴더>/lanekeeper/` 에 레인별 횟수·모델·토큰·지시서 해시 |
| 보고 확인 | 현재 세션 기록의 도구 호출 이름 | 세션별 차단 표시 한 줄 |
| codegraph 기록 | codegraph 응답의 성공·실패 구분 | `.lanekeeper/metrics/codegraph.jsonl` 에 분류와 시각 |
| 체크포인트 | git 상태 | 레인 브랜치의 임시 커밋. 추적 중인 파일만 넣고 `.env*`·`*.pem`·`*.key`·`id_*`·`*credentials*`·`*.p12` 는 빼고 알린다 |

대화 본문은 저장하지 않는다. 비밀값과 환경 변수는 로그에 쓰지 않는다(`tests/l14-security.test.mjs` 가 환경 변수 출력 코드를 검사한다).

## 무인 재개 권한

자동 재개는 launchd 에이전트나 systemd 사용자 타이머를 등록한다. 그래서 사용자가 `/lanekeeper:auto-retry on` 을 실행하기 전까지는 꺼져 있다. 켜면 기본 권한 모드(`default`)로 실행한다. `bypassPermissions` 는 사람이 프롬프트에 `/lanekeeper:approve retry-bypass` 를 입력해 위험을 확인한 기록이 있을 때만 쓰인다. 이 기록은 `~/.lanekeeper/personal.json` 에서만 읽으므로 저장소 설정으로 대신할 수 없다. 기록이 없으면 `default` 로 낮춰 실행한다. 자격 증명은 저장하지 않는다.

## 함께 쓰는 도구의 라이선스

Lanekeeper 는 아래 도구를 포함하지 않고 설치 방법만 안내한다.

| 도구 | 쓰는 곳 | 라이선스 |
|---|---|---|
| codegraph(`@colbymchenry/codegraph`) | 코드 색인 | MIT(npm 패키지 정보 기준) |
| openpyxl | 시험 결과 엑셀 | MIT |
| Pillow | PNG → WebP 변환(선택) | MIT-CMU |
| cwebp(libwebp) | PNG → WebP 변환(선택) | BSD-3-Clause |
| Playwright | 화면 시험(프로젝트가 설치) | Apache-2.0 |

codegraph 는 `/lanekeeper:init` 에서 사용자가 동의한 경우에만 설치한다.

## 공개 전 점검

- 비밀값 검사: `gitleaks git .` 와 `gitleaks dir .`
- 내부 정보 검사: `npm test` 의 저장소 검사(사설 IP·메일 주소·홈 폴더·프로젝트 고유 문자열). 고객명 목록은 공개 저장소에 두지 않고 관리자 머신에서 따로 검사한다.
