# Changelog

이 저장소는 semver 를 따른다. 0.x 동안에는 minor 버전에서도 설정 형식이 바뀔 수 있다.

## [Unreleased]

### Added
- `main` 같은 보호 브랜치의 허가(`merge-main`·`push-main`·`commit-main`)를 Claude Code 확인 창으로도 받는다. 메인 세션의 에이전트가 `lanekeeper-grant <동작> [브랜치나 커밋] [--to 브랜치] [--remote 원격]` 를 한 줄 단독으로 실행하면, `default`·`acceptEdits` 모드에서 창이 뜬다. `auto` 에서는 슬래시 명령을 안내한다. `merge-main`·`push-main` 창에는 목적지(`push-main` 은 원격 이름과, 비밀번호·토큰을 지운 주소 포함), 보낼 대상, 짧은 커밋 ID, 커밋 제목, 유효 시간이 보이고, 게이트 명령이 있는 프로젝트에서는 같은 커밋에 게이트 표식이 있는지도 보인다. `commit-main` 창에는 현재 커밋 위에 새 커밋 1개가 생긴다는 것과 스테이지된 파일 목록이 보인다
- 허용하면 슬래시 명령과 같은 `owner-grant.json` 을 쓴다. 15분·1회·지정 커밋 제한도 같고, 병합·push·커밋을 판정하는 `git-guard` 의 허가·게이트 표식 검사도 그대로다. 표는 동작·대상·커밋과 목적지 또는 스테이지 내용에 묶이므로, 창을 띄운 뒤 이 값이 달라지면 허가를 만들지 않는다. 허가와 결정 기록에는 창을 띄운 세션의 식별자도 남는다
- 허가도 `owner-decisions.jsonl` 에 `via`(`dialog`·`slash`)와 함께 남긴다. `owner-grant.json` 에도 `via` 가 붙는다
- `/lanekeeper:doctor` 와 허용 규칙 검사가 `lanekeeper-grant` 를 덮는 `permissions.allow` 규칙도 찾는다. `claude -p` 를 함께 쓴 명령의 거절 범위에도 이 명령을 넣었다
- 시험 `tests/owner-dialog.test.mjs`: 허가 3개 동작 × 권한 모드 6개 × 주 세션·서브에이전트, 묶인 명령, 표 재사용·위조, 창을 띄운 뒤 커밋 이동, 만들어진 허가로 커밋 통과, 빈 저장소의 첫 커밋

### Changed
- **기존 슬래시 허가의 동작이 바뀐다.** 슬래시와 확인 창 허가 모두에 아래 규칙을 적용한다
  - 한 줄에 보호 브랜치 반영(커밋·push·병합, 섞인 경우 포함)이 2건 이상이거나 반복문 안에 있으면 거부한다. 전에는 `git commit -m a && git commit -m b` 가 허가 하나로 통과했다
  - `merge-main`·`push-main` 허가는 목적지 브랜치에 묶인다. `/lanekeeper:approve merge-main|push-main [브랜치나 커밋] [--to 보호 브랜치]` 로 정하고, 생략하면 지금 체크아웃한 보호 브랜치, 그것도 아니면 설정의 첫 보호 브랜치다. `push-main` 은 지정한 대상이 보호 브랜치면 그 브랜치다. `main` 이 아닌 보호 브랜치로 보내려면 `--to` 가 필요할 수 있다
  - `commit-main` 허가는 허가할 때 스테이지된 내용에 묶인다. 그래서 스테이지를 먼저 끝낸 뒤 허가를 받아야 한다. 스테이지가 달라지면 거부한다. `git commit -a`, `git commit <경로>`, `--include`·`--only`·`--patch`·`--interactive`, `--amend`, `cherry-pick`·`revert`·`am` 은 이 허가로 실행할 수 없다. 스테이지를 바꿀 수 있는 명령을 같은 줄에 쓴 커밋도 거부한다(`git add . && git commit` 등)
  - `push-main` 허가는 원격 주소에도 묶인다. `--remote <이름>` 으로 정하고, 생략하면 그 브랜치의 기본 원격이다. 이름으로 한 push 와 주소를 직접 쓴 push 모두 비밀번호·토큰을 뺀 주소로 대조한다. 그래서 허가 뒤 `git remote set-url` 로 주소를 바꾸면 거부된다
  - 함수로 두 번 호출한 반영과, `--tags`·`--follow-tags` 를 붙인 보호 브랜치 push 는 2건으로 세어 거부한다. 태그는 창에 보이지 않는 내용이 함께 올라가기 때문이다
  - 보호 브랜치 커밋·push·병합의 같은 줄에 `core.hooksPath`·`core.fsmonitor`·`GIT_CONFIG_*`·`--config-env` 처럼 내용을 바꿀 수 있는 지정이 있으면 거부한다. 기능 브랜치 push 는 그대로다
  - `https://`·`ssh://` 로 적은 같은 서버 경로는 같은 주소로 대조한다. `git@host:path` 는 로그인 홈 기준 경로여서 `ssh://host/~/path` 와 같고 `https://host/path` 와는 다르게 본다. 경로의 대소문자는 구분한다
  - 보호 브랜치 push 의 같은 줄에 `core.sshCommand`·`GIT_SSH_COMMAND`·`GIT_SSH`·`-c ssh.*`·`--exec`·`--receive-pack` 이 있으면 거부한다
  - 허가 파일의 `version`, 미래의 `created`, 그 동작에 없는 항목을 검사한다
  - 현재 폴더의 저장소와 `LANEKEEPER_PROJECT_DIR` 의 저장소가 다르면 허가를 만들지 않는다. 같은 저장소 안의 하위 폴더 프로젝트는 그대로 쓸 수 있다
- 다음은 이제 확인 창으로 묻는다: `.git/hooks/*`·`.git/config`·`~/.gitconfig` 쓰기(파일 도구·리디렉션), 읽기만 하는 것으로 정해 둔 명령 밖에서 이 글자를 적은 명령과 `.git/` 안에서 실행한 그런 명령, `git config core.hooksPath`·`git config remote.<이름>.push` 같은 설정 변경, `git init --template`·`GIT_TEMPLATE_DIR`·`init.templateDir`, `.git/` 를 대상으로 한 `cp`·`mv`·`rsync`·`install`·`ln`·`tar`·`unzip`, 단독 `export`·`declare -x`·`typeset -x` 로 내보낸 `GIT_CONFIG_*`·`GIT_DIR`·`GIT_INDEX_FILE`·`GIT_WORK_TREE`. 평범한 `git init`, 새 폴더의 `git init --bare --template`, `git clone --template` 은 묻지 않는다. 묻지 않는 읽기 명령은 기존 읽기 목록, `-i` 없는 `sed`, `awk`, `bat`, `tree`, `-exec`·`-delete` 없는 `find`, `docker`, `npm`·`pnpm` 이다
- `:` 없는 refspec 의 push 는 `remote.<이름>.push` 가 목적지를 바꾼다. 그래서 같은 줄이나 저장소·전역 설정에 이 값이 있으면, 평범한 `git push origin feature/x` 도 `--all` 처럼 거부한다. 같은 줄의 `GIT_CONFIG_*`·`--config-env` 도 같다. `:` 를 적은 기능 브랜치 refspec 은 이 설정의 영향을 받지 않아 그대로 판정한다
- 저장소·전역·같은 줄(`-c`, `GIT_CONFIG_*`)에서 `remote.<이름>.mirror` 가 참인 원격으로 가는 push 는 그 원격의 모든 ref 를 덮어쓰므로 `--all` 처럼 거부한다. 그 원격의 설정만 보고, 값이 거짓이면 이 이유로 거부하지 않는다. `git config remote.<이름>.mirror` 쓰기와 `git remote add --mirror` 는 확인 창으로 묻는다
- 이 훅은 명령의 글자를 읽어 판정하는 로컬 방어선이어서 서버 쪽 브랜치 보호를 대신하지 않는다(`README`·`SECURITY`)
- 목적지가 `*`·`?`·빈 값인 push, `push.default=matching`, `-c remote.*.push`, `GIT_CONFIG_*` 로 준 같은 설정, 저장소 설정의 `remote.<이름>.push` 는 `--all` 처럼 거부한다. 와일드카드 태그 push 도 여기에 포함된다
- 허가가 없어 막혔을 때의 안내와 `skills/approve`·`skills/integrate`·`skills/work` 가 확인 창을 먼저 띄우도록 안내한다. 강제 push 금지, 게이트 표식 요구, 서브에이전트 차단, 허가 파일 직접 쓰기 차단은 바뀌지 않았고, `retry-bypass` 는 슬래시 명령으로만 받는다
- 확인 창은 허용한 쪽이 사람인지 증명하지 못한다. 이제 이 한계가 `main` 에 반영하는 허가에도 적용된다(`README`·`SECURITY` 의 한계 절)

### Fixed
- 커밋이 하나도 없는 저장소에서 `main` 에 첫 커밋을 만들 수 없었다. `/lanekeeper:approve commit-main` 이 `HEAD` 를 풀지 못해 거절했고, `main` 위의 `git commit` 은 허가가 없어 거부됐다. 이제 `refs/` 아래에 ref 가 하나도 없고 연결 워크트리가 아니며 HEAD 가 보호 브랜치를 가리킬 때에 한해, 슬래시와 확인 창 모두 `commit-main` 허가를 만든다. 이 허가의 `head` 는 실제 커밋 ID 와 겹치지 않는 표식값이어서, 저장소에 커밋이 생기면 거부된다. 고아 브랜치, 연결 워크트리, 분리된 HEAD, 깨진 ref, `merge-main`·`push-main` 은 거절한다
- 안전 훅이 `do`·`then`·`else`·`elif`·`if`·`while`·`until`·`!`·`coproc` 뒤의 명령을 검사하지 않았다. 그래서 `if true; then git push origin main; fi` 같은 줄이 허가 없이 통과했다. 이제 이 낱말 뒤의 명령도 같은 규칙으로 판정한다
- 안전 훅이 `find -exec`·`-execdir`·`-ok`, `flock`, `ssh-agent`, `setsid`, `script`, `watch`, `gtimeout`, `ionice`, `arch` 안의 명령을 검사하지 않았다. 이제 판정한다. `sh <<< "..."` 와 `echo "..." | sh` 는 그 글자를 판정하고, `parallel` 과 내용을 읽을 수 없는 입력(`cat a | sh`, `sh < 파일`)은 `shell.unresolved` 로 거부한다. 목록에 없는 감싸기 명령 안의 명령은 여전히 판정하지 못한다
- `!` git 별칭 안의 `git add` 가 같은 줄 검사를 지나쳐, 스테이지 밖 내용이 커밋될 수 있었다. 미리 만들어 둔 별칭도 실행할 때 같은 검사를 받는다
- `gh api -XPUT`·`--method=PUT` 처럼 붙여 쓴 PR 병합과 `mergePullRequest` 호출을 찾지 못했다
- `git push` 의 축약 옵션(`--forc`, `--mirr`)과 `@`·`heads/main`·`HEAD:heads/main` 표기가 보호 브랜치 판정을 지나쳤다
- `--dry` 와 `HEAD:refs/remotes/origin/main` 처럼 보호 브랜치에 반영되지 않는 push 가 허가를 소비했다
- `--dry-run --no-dry-run`, `-o -n`, `--push-option -n` 을 dry-run 으로 봐서 허가 없이 통과했다. 이제 옵션의 값을 옵션으로 세지 않고 마지막 `--[no-]dry-run` 으로 판정하며, 읽지 못하는 낱말이 있으면 dry-run 으로 보지 않는다
- `git push origin tag v1` 이 기능 push 2건으로 세어 창이 두 번 떴다
- 허가가 없을 때의 안내가 설정과 관계없이 15분으로 적던 것을 `git.owner_grant_ttl_min` 값으로 고쳤다
- 확인 창 판정 안에서 도는 git 호출에 4초 제한을 두었다

## [0.2.3] - 2026-11-06

### Fixed
- 토큰 가드: 가장 최근 공식 값에 5시간 항목이 없으면(`five_hour: null`) 5시간 창을 판정에서 뺀다. 전에는 마지막 5시간 기록과 옛 보정 계수로 값을 계속 추정해, 공식 7일 값이 10% 인데 99% 경고가 나갔다. `lanekeeper-token status` 에 이 사실이 표시된다. 5시간 한도 없음이라는 해석은 관찰한 응답 형태에 근거하며 정책 문서로 확인하지 않았다
- 토큰 가드: 5시간 한도 거절을 찾는 대화 기록 검사가 마지막 5시간 기록 이후 전체를 읽던 것을 최근 5시간으로 제한했다. 같은 코드를 쓰는 개인 도구에서 잰 값은 처음 실행 37.6초가 1.8~3.2초로 줄었다(이 플러그인에서 직접 재지는 않았다).
- 시험 `tests/l3-token-official.test.mjs`: 5시간 값 없음, 그 뒤 거절 기록, 5시간 이전 기록을 읽지 않는 경우

## [0.2.2] - 2026-11-06

### Added
- 약화 결과 승인과 게이트 잠금 삭제를 Claude Code 확인 창으로도 할 수 있다. 메인 세션의 에이전트가 `lanekeeper-quality accept <종류> --reason "사유"` 나 `lanekeeper-reap --gate-lock` 을 한 줄 단독으로 실행하면, `default`·`acceptEdits`·`auto` 모드에서 창이 뜬다. 창에는 무엇을 승인하는지 보이고, 거절하면 아무것도 바뀌지 않는다
- 허용한 명령에는 훅이 일회용 표를 붙인다. 표는 10분 안에 한 번만 쓸 수 있고 창에 보인 내용에 묶인다. 저장소에는 해시만 둔다(`<git 공용 폴더>/lanekeeper/owner-ticket.json`). 이 파일도 Bash·파일 도구로 쓸 수 없다
- 실행된 소유자 결정을 `<git 공용 폴더>/lanekeeper/owner-decisions.jsonl` 에 경로(`dialog`·`slash`)와 함께 남긴다. `accepted.json` 항목에도 `via` 가 붙는다. 거절된 창은 이벤트가 없어 기록되지 않는다
- `/lanekeeper:doctor` 가 이 명령을 덮는 `permissions.allow` 규칙을 경고한다
- 시험 `tests/owner-dialog.test.mjs`: 권한 모드 6개 × 주 세션·서브에이전트, 묶인 명령, 표 재사용·위조, 승인 내용 변조

### Changed
- 다른 권한 모드, `-p`·SDK, 서브에이전트, 묶거나 바꾼 명령, 허용 규칙이 있을 때는 창 없이 거부하고 슬래시 명령을 안내한다. 표가 없으면 두 명령은 전처럼 종료 코드 4 로 끝난다
- `claude -p` 를 함께 쓴 명령의 거절 범위를 `lanekeeper-quality accept` 와 `lanekeeper-reap --gate-lock` 까지 넓혔다
- `retry-bypass` 는 권한 검사를 끄는 승인이라 슬래시 명령으로만 받는다. 슬래시 명령 세 가지는 그대로 쓸 수 있다

## [0.2.1] - 2026-11-06

### Changed
- 소유자가 해야 하는 결정 세 가지를 `/lanekeeper:approve` 로 옮겼다. 전에는 일반 터미널에 없는 명령이나, 에이전트도 붙일 수 있는 플래그에 맡겨서 실제로 막지 못하거나 사람이 쓸 수 없었다
  - 약화 결과 승인: `/lanekeeper:approve accept-quality <종류> --reason 사유`. `lanekeeper-quality accept` 는 안내만 출력하고 종료 코드 4 로 끝난다. TTY 검사는 뺐다. 가상 터미널을 만들면 에이전트도 통과할 수 있어서 사람을 확인하는 수단이 아니기 때문이다
  - 자동 재개의 `bypassPermissions`: `/lanekeeper:approve retry-bypass`. `lanekeeper-retry mode bypassPermissions` 는 `--i-understand` 를 붙여도 거절한다
  - 오래된 게이트 잠금 삭제: `/lanekeeper:approve clear-gate-lock`. `lanekeeper-reap --gate-lock` 은 안내만 출력하고 종료 코드 4 로 끝난다
- 사람이 입력하는 명령을 슬래시 명령 중심으로 안내한다. 판 번호가 든 `bin` 경로를 `PATH` 에 넣으라는 안내를 뺐다(`docs/*/01-getting-started.md`, `docs/*/05-troubleshooting.md`)
- 설치 안내를 README 와 같게 맞췄다(통합 마켓플레이스 먼저, 단독 설치 다음). 문서의 판 번호 예시를 현재 판으로 고쳤고, 시험이 어긋남을 잡는다

### Fixed
- 보안: 저장소의 `.lanekeeper/config.json` 에 `personal.auto_retry` 를 넣으면 자동 재개가 `bypassPermissions` 로 실행될 수 있었다. 이제 확인 기록은 `~/.lanekeeper/personal.json` 에 있을 때만 인정한다
- 안전 훅이 `accepted.json` 쓰기와 `personal.json` 의 `bypass_ack` 쓰기를 막지 않아서, 소유자 결정을 에이전트가 파일로 직접 만들 수 있었다. 이제 Write·Edit·Bash 모두 권한 모드와 관계없이 거절한다(`safety.paths.accepted`, `safety.paths.ack`). Bash 로 `personal.json` 을 쓰는 것도 함께 막힌다
- 안전 훅이 `claude -p "/lanekeeper:approve …"` 를 막지 않아서, 에이전트가 Bash 로 띄운 헤드리스 세션에서 허가를 만들 수 있었다. 이제 명령줄에 `claude` 와 `lanekeeper:approve` 가 함께 있으면 거절한다. 변수나 파일로 간접 전달하는 경우는 스크립트 파일 안의 명령처럼 검사 범위 밖이다
- 0.2.0 이전에 남긴 게이트 통과 표식(`wb-gate-pass.json`)을 읽지 못해, 같은 커밋인데도 게이트를 다시 돌려야 했다. 기본 표식 이름을 쓰는 경우 옛 표식도 그 커밋에 유효하다

### Added
- 옛 이름에서 옮기는 절(README 영문·한국어, `docs/*/01-getting-started.md`)에 `wb-*` → `lanekeeper-*` 대응표, `claude plugin marketplace remove wb-plugin`, `wb` 를 함께 켜면 훅이 두 번 실행된다는 경고를 더했다
- 시험 `tests/owner-decisions.test.mjs`: 슬래시 승인, 모델 호출 거부, 권한 모드별 처리, 묶인 명령 거부, 옛 표식

## [0.2.0] - 2026-11-05

### Changed
- 저작권자·작성자 이름을 다른 플러그인과 같은 「Wook Jang」으로 바꿨다(LICENSE·`plugin.json`·`marketplace.json`)
- 플러그인 이름을 `wb` 에서 `lanekeeper` 로 바꿨다(표시 이름 「Lanekeeper — Agent Workbench」). 명령은 `/lanekeeper:*`, 도구 25개는 `bin/lanekeeper-*`, 설정 폴더는 `~/.lanekeeper` 와 `<repo>/.lanekeeper`, 공유 상태는 `<git 공용 폴더>/lanekeeper`, 환경 변수는 `LANEKEEPER_*`, 지시서·결정 표식은 `lanekeeper-brief`·`lanekeeper-decision` 이다. 기본 브랜치 이름은 `lanekeeper/*/int`·`lanekeeper/*/l*`, 게이트 표식은 `lanekeeper-gate-pass`, 자동 재개 작업의 이름은 `lanekeeper.auto-retry.<id>` 로 바뀌었다. 저장소 주소는 https://github.com/wook8170/lanekeeper 다
- 옮기는 방법: `claude plugin uninstall wb@wb-plugin` 으로 옛 플러그인을 지우고 `claude plugin install lanekeeper@lanekeeper`(통합 마켓플레이스는 `lanekeeper@wook8170-plugins`)로 설치한다. 새 이름으로 바꾸려면 세션을 닫은 뒤 `mv ~/.wb ~/.lanekeeper`, 프로젝트마다 `git mv .wb .lanekeeper`, 저장소마다 `mv .git/wb .git/lanekeeper` 를 실행한다. `wb/…` 브랜치로 시작한 레인을 이어 쓰려면 `git.integration_branch_pattern`·`git.lane_branch_pattern` 을 `wb/*/int`·`wb/*/l*` 로 둔다
- 자동 재개(`personal.auto_retry.enabled`)의 기본값을 `false` 로 바꿨다. 자동 재개는 launchd 에이전트나 systemd 사용자 타이머를 등록하므로, 사용자가 `lanekeeper-retry on` 으로 켤 때만 동작한다. 꺼져 있으면 세션을 시작할 때 도는 자동 재개 훅은 아무것도 더하지 않는다
- codegraph·ripgrep 이 없을 때 Claude 에게 주는 안내를 바꿨다. 전에는 사용자에게 묻지 않고 설치하라고 했다. 이제는 설치 명령을 사용자에게 알리고, 동의를 받은 뒤에만 설치한다(규칙 `codegraph-install`, `rg-search` 의 복구 방법, 메시지 `search.rg_missing`)
- 시험 결과를 모으는 설정 틀(`templates/test-results/project/verify.config.json`)의 명령을 `npx vitest`·`npx playwright` 에서 프로젝트에 설치된 `./node_modules/.bin/vitest`·`./node_modules/.bin/playwright` 로 바꿨다. 문서의 예시 명령도 `pnpm exec playwright test` 로 바꿨다

### Added
- 옛 이름 읽기(`lib/naming.mjs`): `~/.lanekeeper` 가 없으면 `~/.wb` 를, `<repo>/.lanekeeper/config.json` 이 없으면 `<repo>/.wb/config.json` 을, `<git 공용 폴더>/lanekeeper` 가 없으면 `<git 공용 폴더>/wb` 를 읽는다. `WB_*` 환경 변수는 같은 이름의 `LANEKEEPER_*` 가 없을 때 그 값으로 쓴다. 둘 다 있으면 새 이름을 쓴다. 파일은 옮기지 않으며, 옛 이름을 읽은 첫 세션에서 `rules/session-start` 훅이 한 번 알린다
- `plugin.json` 에 디렉터리 등재에 쓰는 항목을 넣었다: `homepage`·`repository`·`icon`·`documentationUrl`·`supportUrl`·`privacyPolicyUrl`. 개인정보 처리에 관한 안내 `PRIVACY.md`(영문)를 더했다
- README(영문·한국어)에 「What it runs, sends and fetches」·「실행하는 것 · 보내는 것 · 가져오는 것」 절을 더했다. 이벤트별 훅, `bin/` 도구, 외부 통신을 모두 적었다. `bin/` 이 있어 Claude Code 전용이라는 점도 적었다
- 시험 `tests/naming.test.mjs`: 새 경로 우선, 옛 경로 대체, 1회 안내, 환경 변수 우선순위, 옛 표식 인식

## [0.1.5] - 2026-11-05

### Changed
- 기본 라우팅에서 `fable` 모델을 뺐다. 기본 모델은 모든 Claude Code 계정에서 쓸 수 있는 opus·sonnet·haiku 세 개다. `design`·`review`·`adversarial` 의 사슬은 `fable → opus` 에서 `opus` 로 바뀌었고, 최소 등급(opus)과 나머지 작업 종류의 사슬은 그대로다. 더 높은 모델을 쓰려면 개인 설정 `~/.wb/routing.json` 의 `routing.models` 에 그 모델을 넣고 사슬 맨 앞에 둔다(예: `examples/routing.json`). 적대 검증 스킬·에이전트·지시서 틀의 모델 안내도 같은 기준으로 고쳤다
- 부하 문턱 `auto` 비율: 가벼운 작업만 허용(`light_only`)을 논리 코어 × 2 에서 × 1.5 로 내렸다. 새 레인 보류(× 2)와 무거운 실행 중지(× 2.8)는 그대로다. 전에는 기본값에서 가벼운 작업만 허용과 새 레인 보류가 같은 값이라 「가벼운 작업만」 단계가 생기지 않았다. 숫자로 정한 `machine.load.tiers` 는 영향을 받지 않는다
- 문체 규칙 `rules/writing-style.{ko,en}.md` 에서 저자 개인 파일(`~/.claude/rules/…`)을 가리키던 줄을 뺐다. 규칙 본문은 그대로다
- `README.md`·`SECURITY.md` 를 영어판으로 바꾸고, 한국어판은 `README.ko.md`·`SECURITY.ko.md` 로 옮겼다. 두 판의 첫 줄에 언어 전환 줄을 두었다. README 첫 화면에 통합 마켓플레이스와 단독 설치 명령, 필요한 Node.js(18.19 이상)·Claude Code(2.1.295 이상) 판을 적었다

### Fixed
- 필요한 Node.js 판을 18.19 이상으로 바로잡았다(`package.json` 의 `engines`, README, 시작하기 문서). 18.18 이하는 확장자가 없는 `bin/wb-*` 스크립트를 ES 모듈로 실행하지 못해 명령이 모두 실패한다
- 전역 git 설정이 없는 리눅스 CI 에서는 체크포인트 시험이 커밋 작성자를 찾지 못해 실패했다. 그래서 시험 `tests/safety-fixture.mjs` 가 작성자 정보를 직접 넣는다

### Added
- 플러그인 아이콘(1024px 정사각 PNG, `.claude-plugin` 폴더): 평행한 레인 세 줄과 관문 하나를 두 색으로 그렸다. 원본은 같은 폴더의 SVG 이고, PNG 는 rsvg-convert 로 1024px 크기로 굽는다
- GitHub Actions CI(`.github/workflows/ci.yml`): push·pull_request 마다 Node 18·20·22 와 ubuntu·macOS 조합으로 `npm test` 를 돌리고, 따로 `claude plugin validate --strict` 를 돌린다
- 시험: 기본 라우팅이 opus·sonnet·haiku 만 쓰는지, 기본 부하 문턱 세 개가 서로 다르고 오름차순인지, README·SECURITY 의 언어 전환 줄과 첫 화면 설치 명령, 아이콘 규격

## [0.1.4] - 2026-11-03

### Changed
- 문체 규칙 `rules/writing-style.{ko,en}.md` 의 세 문체(haeyo·report·plain)에 읽기 어려운 문장 네 가지 금지(연결 단어 생략·사물 의인화·명사 셋 이상 이어 붙이기·짝이 되는 말 멀리 띄우기)를 더했다. `/wb:writing-style` 스킬과 검증 에이전트 두 개(`design-adversary`·`ux-adversary`)의 지시문에도 같은 네 규칙을 적었다

## [0.1.3] - 2026-11-02

### Added
- 스킬 `/wb:design-adversarial`(스킬 28개): 설계 적대 검증. 설계를 쓴 쪽과 다른 맥락의 검증자(`wb:design-adversary`, 권장 Fable, 없으면 Opus, 읽기 전용)가 설계가 인용한 코드 지점을 직접 대조하고, 지적을 높음·중간·낮음으로 나눠 근거 `파일:줄`·고칠 방향을 붙이며 마지막 줄에 `high N` 을 적는다. 설계는 판(2판·3판…)으로 고치고 판마다 바뀐 문단 표식과 반영 대조표(지적 → 수용·불수용 → 반영 위치, 불수용은 근거)를 둔다. 높음만 고친 판은 해당 지적과 그 판의 새 위험만 짧게 재검증할 수 있다. `high 0` 이어야 구현에 들어간다. 오너 결정 항목은 따로 모아 `/wb:decide` 로 확인한다. 화면 설계·시안은 UX 적대 점검의 아홉 축으로 본다. 구현이 끝나면 새 검증자가 코드를 정독해 설계 불변식을 확인한다. 참고 자료: 지시서 틀(ko/en, 디스패치 검사 통과 형식), 검증 보고·반영 대조표 형식
- 검증 에이전트 `agents/design-adversary.md`(도구 Read·Grep·Glob·Bash·Write, Edit 없음)
- 규칙 `design-adversarial-review`(규칙 52개)
- `/wb:work` 흐름: feature 는 지시서(설계) 뒤 `design-review`, 검수 뒤 `impl-review`(작업 종류 `adversarial`), big-design 은 설계 뒤 `design-review`
- 시험: 설계 적대 검증 스킬·에이전트·지시서 검사, 흐름 순서, 출하 검증의 바뀐 화면 단계, 높음 지적의 실패 집계, `web-ui` 초기화의 출하 요구

### Changed
- UX 적대 점검 축을 필수 아홉 축으로 바꿨다: ①논리적 오류 ②정보 표기의 정합성 ③사용자 맥락 ④흐름 맥락 ⑤초보 기준 길 잃음 ⑥다음 할 일 인지 ⑦오류·예외에서 빠져나갈 길 ⑧접근성·좁은 폭·어두운 테마 ⑨디자인 시스템 시각 대조. 발견이 없는 축도 「점검함, 발견 없음」으로 적는다. 점검자는 페르소나를 먼저 정하고, 실제 과업 시나리오를 격리 스택에서 처음부터 끝까지 수행하며, 화면마다 그 사람이 무엇을 이해했고 무엇을 하려 하는지 적는다
- ⑨ 축에 린트 기준선이 못 잡는 시각 위반(붙은 간격, 좁은 줄간격, 섞인 글자 크기·굵기, 표 행 높이, 버튼·배지 크기)을 하나씩 측정해 적게 했다
- UX 적대 점검 판정: 해결하지 않은 차단 **또는 높음** 발견이 있으면 실패(전에는 차단만). `counts.json` 의 `failed` 도 같은 기준
- `/wb:ship-verify`: 선행 관문 뒤, 출하 판정(verifying-production-readiness) 전에 그 판에서 바뀐 화면의 UX 적대 점검 단계를 넣었다. 차단·높음 지적이 남으면 멈추고, 화면을 바꾸는 지적은 모아 오너 확인 뒤 고치며, 결과는 원격에서 열리는 아티팩트(지적 표 + 캡처)로 보고한다
- 규칙 `ship-precheck` 에 바뀐 화면 적대 점검과 높음 차단을 더했다
- `/wb:init` 이 `web-ui` 프로젝트의 `.wb/config.json` 에 `quality.ship.requires: ["ux-adversarial"]` 를 넣는다(기존 설정 파일은 그대로 둔다)

## [0.1.2] - 2026-10-31

### Added
- 규칙 10개(규칙 51개): `lane-commit-policy`·`protected-data`·`rg-search`·`output-language`·`remote-viewer`·`report-accuracy`·`communication`·`root-cause-fix`·`no-emoji-ui`·`codegraph-install`
- 부하 단계 「가벼운 작업만」: `machine.load.tiers.light_only`(기본 `auto` = 논리 코어 × 2, 새 레인 보류 문턱보다 크면 그 값으로 내림). 이 문턱 이상, 새 레인 보류 문턱 미만이면 무게가 `light` 인 작업 종류만 새 레인을 띄우고 나머지는 막는다(`dispatch.load_light_only`). `wb-slot check`·부하 안내·`wb-config doctor` 가 세 문턱을 보인다
- 작업 종류 무게 `routing.tasks.<종류>.weight`(`light` · `heavy`, 없으면 `heavy`). 기본값: design·review·security·adversarial·docs·mockup·mechanical·research 는 light, impl-multi·impl-spec·defect-history 는 heavy
- 작업 종류 `docs`(sonnet → opus, 최소 sonnet, light). 지시서 틀 docs 의 표지가 `type=docs` 를 쓴다
- 보호 데이터 `project.protected_data.{paths, ports, containers}`(보호 목록 규칙): 등록한 DB 파일·DB 포트·컨테이너에 쓰는 명령(쓰기 SQL 을 보내는 psql·mysql·mariadb·sqlite3·duckdb, `pg_restore`·`mysqlimport`·`createdb`·`dropdb`, 쓰기 `docker exec`, `docker cp`, 리다이렉트·cp·mv·rm 등 파일 쓰기, Write·Edit)는 레인에서 막고 메인 세션은 확인 요청(`safety.data.write`). SQL 을 읽을 수 없으면 확인 요청(`safety.data.unclear`), 읽기 질의는 통과
- 레인 커밋 정책 `project.lanes.commit`(`allowed` 기본 · `on-instruction`): `on-instruction` 이면 지시서 표지 `commit=allowed` 나 「커밋 허용」 줄이 없을 때 레인 커밋·cherry-pick·revert 가 확인 요청(`safety.git.lane_commit_instruction`), 체크포인트 커밋은 건너뜀(`commit-policy`)
- 세션 규칙 훅 `hooks/scripts/rules/session-start.mjs`: 세션 시작·`/clear`·압축 뒤에 `rules/language`(personal.language 가 ko·en), `rules/remote-viewer`(personal.report.viewer 가 remote), `rules/conduct`(보고 정확성·소통·수정 원칙)를 넣는다. 설정 `personal.session_rules.{language, remote, conduct}`
- 재귀 grep 안내: `grep -r` 류에 세션당 한 번 `rg`(한글 소스는 `rg -a`) 안내, rg 가 없으면 설치 방법. codegraph 안내 훅과 같은 프로세스에서 돈다(Bash 호출당 node 기동 수 그대로). 설정 `personal.search.rg_hint`
- 시험: `tests/data-guard.test.mjs`·`tests/commit-policy.test.mjs`·`tests/session-rules.test.mjs`, 부하 「가벼운 작업만」 단계·무게 시험

- 옵트인: 안전 훅(`safety/pretool`·`safety/approve`)만 모든 저장소에서 돈다. 디스패치 가드·출하 관문·핸드오프·체크포인트·부하·슬롯·시안·codegraph·토큰 가드·자동 재개·간결 모드·세션 규칙·워크트리 동기화는 `.wb/config.json` 이 있는 저장소(또는 그 저장소의 워크트리)에서만 동작한다. 지시서 없는 Agent 호출 차단도 옵트인 저장소에서만 한다. `WB_ACTIVE=1`·`0` 으로 강제
- `"onFailure": "block"`: `safety/pretool`·`dispatch/dispatch-guard`·`quality/ship-gate` 훅이 실행되지 않거나 시간 초과·비정상 종료하면 도구 호출을 막는다(Claude Code 2.1.295 이상)
- 설정 `personal.global_hooks`(`defer` 기본 · `ignore`): Claude Code 설정(`CLAUDE_CONFIG_DIR/settings.json`, `~/.claude/settings.json`)에 같은 종류의 훅(핸드오프·토큰 가드·자동 재개·간결 모드)이 있으면 wb 의 그 훅을 끈다
- 설정 `personal.handoff.inject`(`summary` 기본 · `full`): 세션 시작에 `progress.md` 첫 절(최대 40줄·2,500자)만 넣고 전체는 파일을 읽게 한다

### Fixed
- 명령 연쇄 안의 브랜치 전환: `git checkout main && git merge feat/x`, `git switch main; git commit …` 처럼 같은 줄에서 브랜치를 옮긴 뒤의 git 명령을 옮긴 브랜치 기준으로 판정한다. 대상을 알 수 없는 전환(`git switch -`) 뒤의 보호 대상 git 명령은 막는다. 회귀 시험 3건(수정 전 실패 확인)

### Changed
- 적대 검증(`adversarial`) 기본 대체 순서를 fable → opus 로 바꿨다(구현 모델 제외 규칙은 그대로)
- codegraph 가 없을 때 세션 시작에 설치·초기화 후 계속하라는 안내(`rules/codegraph-install.<lang>.md`)를 넣는다. 전에는 아무것도 넣지 않았다. `project.codegraph.nudge: off` 면 넣지 않는다
- 문체 규칙 report 에 작성 흔적 목록, 과장·비유 금지 낱말, 근거 없는 판단 예, 개발자 용어 대체표, 마지막 점검 세 질문을 합쳤다

## [0.1.1] - 2026-10-31

### Added
- 스킬 `/wb:quality-ux-adversarial`(스킬 27개): 출하 전 UX 적대 점검. 구현 세션과 분리된 점검자(권장 Fable, 없으면 Opus)가 헤드리스 브라우저로 여정과 경계 상황(밝음·어두움, 넓은·좁은 폭, 키보드만, 권한 없음, 빈 상태, 긴 이름, 많은 데이터, 저장 전 이탈, 뒤로가기·새로고침·딥링크)을 점검하고, 발견마다 사용자가 겪는 일 한 문장 → 재현 → 증거(2x 캡처, 실제 데이터 대조, computed style·픽셀 측정) → 심각도(차단·높음·중간·낮음) → 축(①데이터 적절성·정합성 ②위치·길 찾기 ③현재 화면 할 일 명확성 ④흐름 연속성 ⑤모양 일관성, ⑤도 같은 무게) → 디자인 시스템 기준 수정안 → DOM/CSS 주입 시안 캡처를 남긴다. 제품 코드는 고치지 않고, 메인 세션이 전후 캡처를 나란히 놓은 아티팩트로 오너에게 보고한 뒤 오너가 확인한 것만 고치고 다시 점검한다. 참고 자료: 지시서 틀(ko/en, 디스패치 가드 통과 형식), 발견 보고 틀과 결과 수치 형식, 오너 보고 아티팩트 틀, DOM 주입 시안 캡처 예시(`--hide-scrollbars` 제외, 2x)
- 점검 에이전트 `agents/ux-adversary.md`(플러그인 첫 에이전트): 제품 쪽 읽기 전용, 결과 폴더에만 쓰고 커밋하지 않는다(도구 Read·Grep·Glob·Bash·Write, Edit 없음)
- 품질 결과 종류·범주 `ux-adversarial`: 점검 칸(여정 × 경계 상황) 하나를 시험 하나로 센다. 해결하지 않은 차단 발견이 있는 칸이 실패, 점검하지 못한 칸이 건너뜀이라 점검 범위가 줄면 약화로 잡힌다
- 설정 `project.quality.ship.advisory`(기본 `["ux-adversarial"]`): 출하 검증 선행 관문이 같은 방식으로 확인하되 막지 않고 경고만 하는 종류. 하지 않았거나(수동·없음) 최신 결과에 해결하지 않은 차단 발견이 있으면(실패) `wb-quality precheck`·`status` 표 아래와 관문 훅 안내에 경고가 나오고 종료 코드는 바뀌지 않는다. `requires` 에도 있으면 막는다. 출하 판정 기록(`record ship`)에 경고 종류의 상태도 남고, 버전 취합본에 경고 종류가 행으로 나온다
- 시험: 경고 종류 판정(막지 않음·실패도 경고·`requires` 우선), `wb-quality precheck` 경고 출력과 종료 코드, 관문 훅 경고·끔·막음, 지시서 틀의 디스패치 검사 통과, 에이전트 정의(쓰기 도구 제한), 두 사용성 스킬의 상호 안내

### Changed
- 출하 검증 관문 훅이 선행 종류를 모두 통과해도 경고 종류가 통과하지 않았으면 경고 안내를 붙인다(이전에는 아무 출력 없음)
- `/wb:quality-usability`·`/wb:ship-verify`·`/wb:quality-report` 에 UX 적대 점검과의 관계를 적었다

## [0.1.0]

### Added
- 문서 현행화 `wb-docs`(`map`·`apply`·`drafts`·`verify`·`check`): 기준 브랜치와의 merge-base 부터 작업 트리까지의 변경으로 영향 지도를 만든다. 대상(`docs_sync.targets`)별로 필수(화면 코드에서 사라진 문구가 남은 문서 줄, 짝 파일 `mirrors`, 묶음 `groups`, 규칙 `rules` 의 require)와 검토(바뀐 화면 부분의 문구가 나오는 문서, 바뀐 화면의 시험 ID 가 찍힌 촬영 장면과 그 그림이 실린 문서)를 판정하고, 자동 생성 명령·파일별 수정 초안(옛 문구 → 새 문구)·재촬영 명령·검사·남은 수동 항목을 보여 준다. 촬영 장면은 캡처 스크립트의 키 묶음과 함수 호출 관계(최대 6단계)로 찾는다. `check` 는 필수 미충족이면 종료 코드 1, `--json` 은 품질 결과 `json` 형식(대상 하나 = 시험 하나), 확인 기록(`ack_file`)은 해당 항목만 통과로 센다
- 품질 종류 `docs`(범주 gate): `docs_sync.targets` 가 있으면 `wb-quality` 가 `wb-docs check --base <quality_base>` 를 실행하는 종류를 등록한다(같은 이름의 스위트가 있으면 그쪽). `quality.ship.requires` 에 넣으면 출하 검증 관문이 요구한다. 대상을 빼면 시험 수 감소로 약화 판정
- 스킬 `/wb:docs-sync`(스킬 26개), 설정 `project.docs_sync.*`(24개 키), 예시 `examples/docs-sync-config.json`, 설명서 ko/en, 시험 `tests/docsync.test.mjs` 15건(수정 전 15건 실패 확인)
- 종류별 품질 결과 보관 `wb-quality`(`list`·`run`·`record`·`index`·`status`·`precheck`·`report`·`accept`): 단위·통합·게이트·e2e·UI 안정성·사용성·출하 검증 결과를 종류마다 공통 머리 JSON(`quality-result/1`: 종류·범주·버전·커밋·브랜치·미커밋 여부·시작·끝·환경·판정·총·통과·실패·건너뜀·보류·간헐·임계 파일 해시·원자료 위치)과 엑셀로 `<결과 루트>/<버전>/<날짜>/<종류>-<HHMM>.{json,xlsx}` 에 남긴다. 실행은 `wb-slot` 슬롯과 게이트 잠금 안에서 한다. 결과 형식: `vitest`·`jest`·`playwright`(fixme 주석·재시도 통과 구분)·`pytest`(JUnit XML)·`vitest-log`(모노저장소 로그의 `Tests` 줄 합계)·`json`·`exit`·`steps`(단계마다 시험 하나)
- 결과 색인 `index.json`(`quality-index/1`)·`INDEX.md`: 결과 파일을 훑어 다시 만든다. 이전 형식의 날짜 폴더와 공통 머리가 없는 요약은 내용으로 추정해 올리고(`legacy`·`inferred`), 다른 도구가 붙인 선택 키(`originalPath`·`versionBasis`·`external`·`run`)는 다시 만들어도 남긴다
- 버전 품질 보고서 `wb-quality report`: 버전별 종류 최신 결과로 `quality-<버전>.xlsx`(요약·종류별 시트·실패·실행 이력)와 `.md`·`.html`(밝기 테마 양쪽)을 만든다. 결과 없는 필수 종류, 직전 통과보다 약해진 종류, 알려진 문제(최신 실패), 제외 항목(건너뜀·보류)을 적는다
- 출하 검증 선행 관문: `wb-quality precheck [--run]` 이 `quality.ship.requires` 의 종류마다 최신 결과를 없음·낡음(다른 커밋·미커밋 상태 실행, `stale_paths` 로 범위 지정 가능, 결과 폴더만 바뀐 커밋은 같은 커밋)·실패·약화·수동으로 판정하고, `--run` 은 없음·낡음·실패 종류를 다시 돌린다. 약화 = 직전 통과 결과(약화가 승인되지 않은 결과는 기준에서 빠지는 연쇄 기준) 대비 시험 수 감소·건너뜀+보류 증가·임계 파일 변경(규칙 `max`·`min` 은 완화 방향만, 배열 길이 증가는 완화). 약화 승인은 저장소 소유자가 터미널에서 `wb-quality accept` 로만 한다(에이전트 셸은 거부)
- PreToolUse 훅 `hooks/scripts/quality/ship-gate.mjs`(Agent·Task·Skill): 출하 검증 스킬(`quality.ship.skills`)·에이전트(`quality.ship.agents`)·그 스킬 이름을 담은 지시문을 관문 통과 전에는 막는다(`dispatch.ship_precheck`, `quality.ship.enforce` 로 `warn`·`off` 가능)
- 스킬 8개: `/wb:quality-unit`·`/wb:quality-integration`·`/wb:quality-gate`·`/wb:quality-e2e`·`/wb:quality-uistab`·`/wb:quality-usability`(초보 사용자 대역 에이전트, 판정 기준: 목표 달성·막힘 없음·예상 단계 1.5배 이내, P0 전부 통과)·`/wb:ship-verify`(관문 → 실패 수정·재실행 반복 → 출하 검증 → 판정 기록)·`/wb:quality-report`(스킬 25개)
- 설정 `project.quality.*`(`results_root`·`raw_root`·`version_file`·`suites`·`ship.requires`·`ship.enforce`·`ship.agents`·`ship.skills`), 예시 `examples/quality-config.json`, 규칙 `ship-precheck`(규칙 41개), 엑셀 작성기 `templates/quality/write_xlsx.py`
- 시험 `tests/quality.test.mjs`: 결과 형식 해석, 판정, 공통 머리 검사, 약화(수·건너뜀·임계 해시·max/min 방향), 약화 연쇄 기준(수정 전 실패 확인), 저장소 안 관문 판정(없음·실패·낡음·결과만 바뀐 커밋·미커밋 실행·`stale_paths`·약화·승인·수동), 색인(새 구조·이전 형식·추정·선택 키 보존·Markdown), 취합(버전 구분·누락·HTML), 엑셀, `wb-quality` 실행·관문 자동 실행·기록·보고·승인 거부, 관문 훅(막음·통과·경고·스킬 이름 지시문)

### Changed
- 설명서 시험이 숫자가 든 스킬 이름(`/wb:quality-e2e`)을 스킬로 인식한다
- 토큰 가드가 Claude Code 의 공식 사용량을 1순위로 쓴다. `~/.claude.json` 의 `cachedUsageUtilization`(5시간·7일 비율, 리셋 시각, 계정)과 계정 ID 만 읽는다. 조회한 지 `fresh_min` 분이 지나면 그 뒤 로컬 가중 토큰을 계정별 보정 계수로 환산해 더하고, 리셋 시각이 지나면 리셋 이후 사용분만 센다. 판정은 5시간·7일 중 높은 쪽. 5시간 창은 리셋 5시간 전에 시작하는 고정 구간으로 계산한다
- 보정 계수는 자동으로 잡는다. 공식 값이 바뀔 때마다 `${CLAUDE_PLUGIN_DATA}/token-guard/official-history.jsonl` 에 기록하고, 같은 창 안 두 기록의 비율 증가 ÷ 그 사이 로컬 사용량(없으면 창 시작부터의 비율)을 `calib-<계정>.json` 에 둔다. 사용 한도 거절 기록은 100% 점으로 쓴다. 계정을 바꾸면 이전 계정의 공식 값과 보정은 쓰지 않는다
- `personal.token_guard.budget` 은 공식 값이 없을 때의 대체 예산으로 바뀌었다. 0 이면 계정 보정 계수에서 100% 를 환산하고, 그것도 없으면 침묵한다
- 토큰 가드 안내 문구가 비율의 출처(공식·추정·대체 예산)를 밝힌다
- `wb-token status` 가 공식 값(조회 시각·최신 여부·계정 끝 8자리·리셋 시각), 지금 추정과 증가분, 보정 계수의 근거를 보여 준다
- 시험 결과 엑셀의 시트 이름·머리글·요약 문구·원장 대조 종류가 `personal.language`(ko/en)를 따른다. 문구는 `locales/{ko,en}.json` 의 `xlsx.*` 키에서 읽고, 한국어 결과는 이전과 같다(기록해 둔 통합 엑셀과 대조하는 시험 `tests/py/golden_ko.json`). 영어 설정에서는 영어 시트 이름(`Summary`·`Unit`·…)과 머리글이 나온다
- 엑셀 도구(Python·openpyxl)가 없어 엑셀을 만들지 못해도 게이트와 모든 단계가 통과하면 게이트 통과 표식을 남긴다는 동작을 시험(`tests/manual-findings.test.mjs`)으로 고정하고, 건너뛴다는 안내 메시지·설명서에 명시
- 설명서 문제 해결에 「시간대를 지정하는 설정 키는 없고 시스템 시간대를 쓴다」를 명시

### Fixed
- 깨끗한 Linux 컨테이너(`node:22-bookworm`, 사용자 설정 없음)에서 `npm test` 5건이 실패하던 문제: `lsof` 가 없으면 레인 워크트리 삭제 전 프로세스 확인(`wb-worktree remove`)·고아 프로세스 탐지·포트 임대·보호 포트 종료 판정이 조용히 비었다. `lib/procs.mjs` 를 추가해 `lsof` 가 없으면 `/proc` 에서 작업 폴더와 듣는 포트를 읽는다. 시험은 git 작성자 정보가 없는 환경(체크포인트 커밋)과 `sqlite3` 가 있는 환경(색인 복사 대체 경로)에서도 같은 결과가 나오게 고쳤다
- `wb-test-report run` 이 `.wb/verify.config.json` 의 `gate.script` 이름을 `package.json` 에서 찾지 못하면 스택 트레이스로 죽던 문제: 고치는 방법(스크립트 추가·`gate.script` 변경·`gate.steps`)을 알리고 종료 코드 1 로 멈춘다(ko/en)
- 커밋이 하나도 없는 저장소에서 `wb-worktree create` 가 `git rev-parse --verify HEAD^{commit}` 오류를 그대로 보이던 문제: 「첫 커밋을 만든 뒤 다시 실행」 안내(`wt.no_commit`)
- openpyxl 설치 안내가 Debian 12 이상·Ubuntu 24.04·Homebrew Python 에서 `externally-managed-environment` 로 실패하던 문제: `apt install python3-openpyxl` 과 가상환경(`~/.wb/venv`) + `WB_PYTHON` 방법을 안내 문구·설명서 01·05(ko/en)·README 에 반영
- 설명서 01 장: 초기화 출력 예시에 `.git/info/exclude` 추가 줄 3개 반영, 저장소에 커밋이 하나 이상 있어야 한다는 전제, `gate.script` 의미 설명

### Added
- 시험 `tests/l15-procs.test.mjs`(`/proc` 대체 조회, 설치 안내와 설명서 일치), `tests/l9-testresults.test.mjs`·`tests/worktree.test.mjs` 에 위 결함의 회귀 시험
- 부하 단계(`machine.load.tiers`): 1분 부하가 `hold_new_lanes` 이상이면 디스패치 가드가 새 레인을 막고(`dispatch.load_hold`, lanes.json 에 이미 있는 레인으로 보내는 디스패치는 통과), `stop_heavy` 이상이면 슬롯 가드와 `wb-slot` 이 검수 레인의 무거운 실행을 바로 거부한다(`safety.slot.load_stop_heavy`, `wb-slot` 은 종료 코드 75). 실행 레인과 메인 세션은 기존처럼 `machine.load.max` 대기. 이미 잡힌 슬롯은 건드리지 않는다. 기본값 `auto` = 논리 코어 수 × 2 / × 2.8(반올림), 숫자 지정 가능
- 레인 종류: lanes.json 의 `role`(`executor`|`verifier`, `wb-worktree create <id> --role verifier`), 없으면 레인 지시서 표지의 `role=` 이나 `역할:` 줄, 둘 다 없으면 실행 레인. 검수 지시서 템플릿 표지에 `role=verifier`
- `wb-slot check`: 부하·단계·문턱·레인 수와 종류·슬롯 점유·고아 프로세스 후보를 한 화면에(`--json`)
- `wb-slot reap --orphans [--dry-run|--kill]`: 지워졌거나 lanes.json 에 없는 레인 폴더에서 뜬 vite·tsx·esbuild·vitest·헤드리스 Chrome 을 PID 로 찾아 보여 주고, `--kill` 때만 그 PID 만 하나씩 종료한다(종료 직전에 명령이 그대로인지 다시 확인, 패턴 종료 없음). 이 세션의 프로세스와 보호 포트(`machine.ports.protected`·`machine.servers`)에서 듣는 프로세스는 사유와 함께 제외
- UserPromptSubmit 훅 `hooks/scripts/load/check.mjs`: `machine.load.check_every_min`(기본 30, 0 = 끔)분마다 부하를 보고 문턱을 넘었을 때만 한 줄을 알린다
- 규칙 `load-tiers`(규칙 40개), `/wb:lanes`·`/wb:doctor`·`wb-config doctor` 에 부하 단계 표시, 시험용 환경 변수 `WB_LOAD_FAKE`
- 시험 `tests/load-governor.test.mjs`: 문턱 환산(auto·숫자), 가드 막음·통과 경계, 검수 레인 우선 거부, 고아 탐지(가짜 ps 출력, 보호 포트·자기 세션 제외), 점검 주기
- `wb-token calibrate --five <n> [--seven <n>] [--at HH:MM]`: 앱의 `/usage` 에서 본 값을 보정점으로 넣는다. `wb-token calibrate --check`: 같은 창 안 보정점 쌍별 비율 목록(가중식 점검용)
- 개인 설정 키 `token_guard.fresh_min`(기본 10), `token_guard.source`(`auto`|`official`|`local`, 기본 `auto`)
- 시험 `tests/l3-token-official.test.mjs`: 공식 캐시 읽기, 신선도, 창 시작 비율·두 점 차이 보정, 리셋 경과, 계정 전환, 대체 예산·환산, 출처 설정, 한도 도달 점, 훅·명령 출력
- `wb-test-report gate-pass`: `project.gate.command` 를 실행하고, 통과하면 게이트 통과 표식을 남긴다
- 게이트 통과 표식 기록: `wb-test-report run`(일부 단계만 고르지 않은 실행)과 `gate-pass` 가 커밋하지 않은 변경 없이 통과하면 `<git 공용 폴더>/wb/<git.gate_stamp>.json` 에 커밋 HEAD·시각·명령을 남긴다. 표식이 다른 커밋의 것이면 차단 메시지가 표식의 커밋과 다시 돌릴 명령을 알려 준다
- 결과 파일만 바뀐 커밋 인정: 표식·실행 커밋 뒤에 결과 폴더(`paths.test_results`) 안의 파일만 바뀐 커밋은 보호 브랜치 반영 판정과 `wb-check test-results`(새 항목 `head_results_only`)에서 같은 커밋으로 본다
- 레인 지시서 틀(구현·수정·시험)에 시험 결과 줄 형식 안내(`시험: 통과 12 / 실패 0`, 수정 전 실패는 따로)
- 회귀 시험 `tests/manual-findings.test.mjs`(설명서 따라 해 보기에서 찾은 결함 1~12·14), 파이썬 시험 2건(현지 시각 파일 이름, 결과 줄 언어)
- 사용 설명서 `docs/`(한국어 `docs/ko/`, 영어 `docs/en/` 각 5장: 시작하기와 처음 30분, 기능 안내와 스킬 17개, 설정 키 전체 참조, 규칙 안내, 문제 해결)와 목차 `docs/README.md`. 루트 README 에서 연결
- `wb-rules manual [--lang ko|en] [--write]`: 규칙 카탈로그에서 설명서 규칙 장(`docs/<언어>/04-rules.md`)을 읽는 순서대로 만든다(메시지 코드·관련 설정 포함)
- 설명서 시험 `tests/docs.test.mjs`: 스킬 이름·`wb-*` 명령과 하위 명령·설정 키와 기본값·규칙 수·규칙 장 재생성·링크·한영 구성을 코드와 대조
- `SECURITY.md`·`SECURITY.en.md`: 신고 방법, 보호 범위와 한계, 훅별 실패 시 동작, 외부 명령·셸 실행 지점, 입력 검사, 네트워크, 읽고 남기는 파일, 함께 쓰는 도구의 라이선스
- 게이트 잠금: `wb-test-report run`·`gate` 가 실행하는 동안 `<git 공용 폴더>/wb/gate.lock` 을 잡고 끝나면 지운다. 다른 실행이 잡고 있으면 종료 코드 3. 규칙 `gate-lock` 의 지키는 위치에 추가
- 규칙 카탈로그 `report-artifact`(보고 단계 아티팩트·결과 엑셀 확인 훅 연결, 규칙 39개)
- 저장소 검사에 일반 패턴(사설 IP·메일 주소·홈 폴더)과 금지 문자열 추가
- 보안 시험 `tests/l14-security.test.mjs`(입력 검사, 게이트 잠금, 모든 훅의 깨진 입력·깨진 설정 동작, 셸 실행 지점 허용 목록, 네트워크 사용 위치, 환경 변수 출력 금지)
- `wb-waves handoff check | archive "<요지>" [--from 파일] | migrate [--force]`: 줄 수 점검, 이번 달 아카이브에 날짜 절 덧붙이기(제목 단계를 한 단계 내림), 누적형 파일을 `docs/progress-archive/progress-until-<YYYY-MM-DD>.md` 로 통째로 옮기고(추적 중이면 `git mv`) 현재 상태 양식으로 새로 만들기
- 개인 설정 키 `handoff.max_lines`(기본 300) · `handoff.archive_dir`(기본 `docs/progress-archive`)
- 재개 보고 오래된 항목 `progress_oversize`, `/wb:explain` 항목 `progress_oversize`
- 플러그인 매니페스트(`wb`)와 마켓플레이스 파일, 사용자 설정 2종(메시지 언어, 채팅 보고 분량)
- 디렉터리 골격: hooks · skills · agents · bin · templates · rules · defaults · locales
- 설정 기본값 4종(`defaults/routing.json` · `machine.json` · `personal.json` · `config.json`)
- 설정 해석기 `wb-config`(get · explain · validate · dump · init · doctor)와 층별 병합 규칙
- `/wb:init`, `/wb:doctor` 스킬
- 한국어·영어 메시지 파일
- node:test 단위 시험
- 안전 훅(`hooks/scripts/safety/`): git 판정(행위자 × 브랜치 × 동작), 소유자 허가 `/wb:approve`(15분·1회·지정 커밋, 게이트 표식 연동), 프로세스 종료·광범위 삭제·창 뜨는 브라우저 차단, 보호 경로·상태 파일 쓰기 차단, 설정 오류 시 차단
- 세션 보조 훅(L3): 핸드오프 가드(`progress.md` 주입·낡음 차단), 사용량 한도 자동 재개(launchd·systemd·대기 프로세스, 기본 권한 `default`, `limits.json` 기록), 토큰 가드(구간 사용량·단계별 지침·예산 보정), 간결 모드, 레인 체크포인트 커밋
- CLI `wb-retry` · `wb-token` · `wb-terse`, 스킬 `/wb:auto-retry` · `/wb:token-guard` · `/wb:terse`
- 모델 라우팅(L5): `lib/route.mjs`(작업 종류 분류, 금지 → 한도 → differ_from → 바닥선 → 대기·알림 해석), CLI `wb-route`(tasks · resolve · explain · check · classify)
- 디스패치 검사 훅(PreToolUse Agent|Task): 지시서 표지·필수 절·문구, 모델 미지정·금지·한도·바닥선·사슬 밖, 레인 상한, 바닥선 도달 시 알림·대기
- 지시서 템플릿 7종 ko/en(`templates/briefs/`), `wb-check brief`, 프로젝트 설정 키 `dispatch.{brief, exempt_agents}`
- 개인 설정 키: `auto_retry.bypass_ack`, `handoff.*`, `checkpoint.enabled`, `token_guard.{budget, window_hours}`
- 실행 슬롯 `wb-slot`(무거운 실행·브라우저, 1분 부하 문턱, 임대 갱신·만료·죽은 소유자 회수)과 무거운 명령 패턴(`defaults/heavy-patterns.json`), 슬롯 없이 실행하면 알리거나 막는 PreToolUse 훅
- 포트 `wb-port`(이름으로 조회, 레인 대역 임대, 보호 포트·사용 중 포트 회피), 레인 워크트리 `wb-worktree`(통합 HEAD 기준 생성, 레인 대장 등록, `.worktreeinclude` 복사, 슬롯 안 설치 명령, 프로세스 확인 후 제거), 정리 명령 `wb-reap`
- Claude Code 워크트리 훅(WorktreeCreate·WorktreeRemove)은 선택 기능: `project.worktree.hook`(기본 false)을 켜면 주 체크아웃 `.claude/settings.local.json` 에 등록, 세션 시작 때 플러그인 경로 재동기화, `wb-worktree hooks status|sync`, `/wb:init` 질문 추가
- 레인 포트 기본 대역 41000 시작·레인당 20칸(macOS AirPlay 7000 회피)
- 레인 원장·진행판·재개(L6): `wb-waves`(웨이브·레인 기록, 진행판, 레인별 metrics, 재개 보고·재실행 문구, `subagentStatusLine` 한 줄 상태), SubagentStart·SubagentStop 기록 훅(레인 연결·실행/되돌림 횟수·모델·토큰·지시서 해시), 디스패치 검사 훅의 허용 호출 기록
- 번호 예약 대장 `wb-number`(계열은 `numbers` 설정), 시험 케이스 원장·결함 대장 `wb-cases` · `wb-defects`와 템플릿(`templates/test-cases/`)
- 스킬 `/wb:lanes` · `/wb:pickup` · `/wb:resume`, 프로젝트 설정 키 `waves.stale_min` · `numbers`
- 시험 결과 엑셀(L9): `templates/test-results/core/`(결과 모델, 어댑터 vitest·jest·Playwright·pytest, 원장 대조, 시트 구성 — Python 3.8+ · openpyxl), `templates/test-results/project/`(`verify-all.mjs` 단계 실행기 no-bail·슬롯 래퍼, `run-gate.mjs` gate 단계 기록, `verify.config.json`), CLI `wb-test-report`(env · init · run · gate · build · latest · summary), `wb-check test-results`(최신 엑셀 존재·커밋·원장 불일치), 스킬 `/wb:test-report`. Python 또는 openpyxl 이 없으면 설치 명령을 안내하고 엑셀 생성을 건너뜀
- 검수·취합·보고(L7): `wb-check lane`(검수 9항목, 실패 시 디스패치 검사를 통과하는 되돌림 지시서·원장 기록), `wb-integrate`(시험 병합 → 충돌 분류 원장·등록·생성물·코드 → 규칙 해소 → 재생성 → 번호 중복 → 가드 → 커밋, 코드 충돌·가드 실패는 중단과 되돌림 지시서, 게이트 잠금 대기), `wb-art`(keep·temp·report·env, 300KB 넘는 PNG 를 WebP 로, 이미지를 넣은 단일 HTML 보고), `wb-defects summary · export`(Markdown·xlsx), 훅 `mockup-first`(시안 결정 전 화면 구조 변경 차단)·`artifact-check`(보고 단계 아티팩트·결과 엑셀 확인, 1회 차단), 스킬 `/wb:review-lane` · `/wb:integrate` · `/wb:report`, 설정 키 `review.*` · `integrate.*` · `personal.report.artifact_check`, 템플릿 `templates/review/` · `templates/report/` · `templates/decision/` · `templates/defects/`
- 초보자 계층(L8): `/wb:work`(요청 분류·단계별 모델·진행 한 줄), `/wb:explain`(막힘 설명·차단 코드 → 규칙 연결), `/wb:writing-style`(`style.map` 문체, 지시서 `{{style}}` 자동 채움), `/wb:decide`(결정 기록 `docs/decisions/`)
- 규칙 카탈로그 `rules/catalog.json`(규칙 37개: 이유·지키는 위치·복구 방법, ko/en)과 생성 문서 `rules/catalog.{ko,en}.md`, 문체 규칙 `rules/writing-style.{ko,en}.md`
- CLI `wb-work` · `wb-explain` · `wb-style` · `wb-rules` · `wb-decide`
- 코드 색인 후속(L12b): 설정 키 `project.codegraph.index_on_worktree` → `auto_index`(기본 true, 옛 이름은 한 판 동안 별칭·새 이름 우선, doctor 가 안내). `/wb:init` 이 `.wb/briefs/` 와 함께 `.codegraph/` · `.wb/metrics/` 도 `info/exclude` 에 미리 넣고, init 을 거치지 않아 훅·작업 프로세스가 대신 추가했으면 doctor 가 한 줄로 알림
- 코드 색인(L12): 색인 대기열 `wb-index`(add · run · status · drop · orphans · metrics, 한 번에 하나·`nice`·무거운 실행 슬롯 안), 같은 저장소의 다른 워크트리 색인을 복사한 뒤 바뀐 파일만 sync, 실패 시 init. `wb-worktree create`·WorktreeCreate 훅이 새 워크트리를 대기열에 넣고, 제거 때 색인 삭제. 색인 폴더는 `info/exclude` 에 추가
- codegraph 훅: grep 안내(식별자 하나·색인 있는 체크아웃·세션 1회, 차단 없음), 색인 없는 경로 두 번째 호출 차단, 응답 분류 기록(`.wb/metrics/codegraph.jsonl`), 세션 시작 지침 `rules/codegraph.{ko,en}.md`. `/wb:doctor` 에 색인·대기열·남은 색인 점검. 규칙 카탈로그 `codegraph-first` 를 실제 훅으로 연결하고 `codegraph-index-first` 추가(38개)

### Changed
- 저작권자·연락처: LICENSE·`plugin.json`·`marketplace.json` 저작권자를 「윤결파파」로, SECURITY 신고 메일을 공개 연락 메일로 채웠다. 내부 정보 검사는 이 메일을 정해진 파일에서만 허용한다
- 시험 결과 파일 이름의 날짜·`HHMM` 을 이 머신의 현지 시각(시스템 시간대)으로 붙인다(이전에는 UTC)
- `wb-test-report run` 의 `[verify]` 줄과 엑셀 결과 줄을 설정 언어로 출력한다(`verify-all.mjs --lang`, `build_xlsx.py --lang`)
- 검수 8번 항목이 「통과 1」·「passed: 7」처럼 숫자가 뒤에 오는 형식도 읽고, 「수정 전 실패 1건」 같은 수정 전 기록은 실패로 세지 않는다
- 소유자 허가의 만료 시각을 현지 시각과 시간대 차이로 보여 준다(예 `2026-10-17 22:55 (UTC+09:00)`)
- 규칙 카탈로그에서 아직 지키는 곳이 없는 규칙의 문구를 「아직 없음(이후 판에서 추가)」로 바꿨다(내부 작업 이름 제거)
- SECURITY 의 토큰 가드 항목: 훅은 예산을 정하기 전에는 대화 기록을 읽지 않고, `wb-token status`·`calibrate` 는 예산과 관계없이 읽는다고 고쳐 적었다
- 설명서(한국어·영어): 시작하기 4.7·4.10 절, 기능 안내 명령 목록, 문제 해결 메시지 표·자주 묻는 질문·알려진 제한을 고친 동작에 맞췄다
- 규칙 카탈로그 문구를 처음 쓰는 관리자가 읽기 쉬운 업무 문체로 다시 썼다(규칙·이유·복구, ko/en). 규칙마다 짧은 이름(`title`)을 더했고, 생성 문서의 제목은 `### <이름> (\`<id>\`)` 형식이다. 머리말에 레인·웨이브·취합 담당·소유자·게이트의 뜻을 적었다. `wb-rules list` 는 이름을 보여 준다
- 큰 설계 트랙 플러그인 이름을 코드에서 빼고 개인 설정 `design_plugin`(기본 빈 값)으로 옮겼다. 비어 있으면 `wb-work plan` 이 설정 방법을 안내한다
- 쓰이지 않던 기본 설정 `paths.progress`(실제 경로는 `personal.handoff.file`)와 `paths.waves`(원장은 `<git 공용 폴더>/wb/`)를 지웠다
- codegraph 설치 안내 예시를 npm 패키지 명령(`npm install -g @colbymchenry/codegraph`)으로 바꿨다
- 시험과 주석의 포트 예시를 일반 값(8080·3000)으로 바꿨다
- 핸드오프 파일 방식 변경: `progress.md` 는 지금 유효한 상태만 담고(기본 300줄 이하) 매 웨이브 통째로 다시 쓴다. 끝난 내용은 `docs/progress-archive/progress-<YYYY-MM>.md` 끝에 `## <YYYY-MM-DD HH:MM> — <요지>` 절로 덧붙인다. 「최신 절을 맨 위에 추가하고 이전 절 유지」 안내를 없앴다
- 세션 시작 훅·`wb-waves resume`·`/wb:pickup`·`/wb:resume` 은 `progress.md` 전체를 보여 주고 아카이브 검색 방법(`grep -n '<키워드>' docs/progress-archive/*.md`)을 안내한다. 기준 줄 수를 넘은 누적형 파일만 최신 절을 보여 준다
- 종료 가드 문구가 아카이브 덧붙임 → 통째로 다시 쓰기 → 두 파일 함께 커밋 순서를 요구하고, 파일이 기준을 넘으면 옮기는 방법을 덧붙인다
- 규칙 카탈로그 `progress-handoff` 의 규칙·이유·복구 문구와 지키는 위치(`bin/wb-waves`, `personal.handoff`)를 갱신

### Fixed
- 게이트 명령(`project.gate.command`)을 둔 프로젝트에서 표식을 쓰는 곳이 없어 `/wb:approve merge-main`·`push-main` 허가가 있어도 보호 브랜치 병합·push 가 항상 막히던 문제
- 결과 엑셀만 커밋해도 `wb-check test-results` 가 「다시 돌리십시오」 경고를 내던 문제
- 보호 브랜치 push 차단 메시지가 대상 브랜치 대신 지금 체크아웃한 브랜치 이름을 적던 문제
- `/wb:init` 과 init 스킬이 들어 있지 않은 스킬(`ui-check`·`advanced`)을 안내하던 문제
- 되돌림 지시서의 브랜치 칸에 실제 이름 대신 「레인 브랜치」가 들어가던 문제(`--lane-dir` 체크아웃 또는 레인 대장에서 읽는다)
- `wb-explain code` 첫 줄에 `{cmd}` 같은 자리가 그대로 나오던 문제(`<cmd>` 로 표시)
- `wb-check brief <없는 파일>` 이 Node.js 스택으로 끝나던 문제(안내 문구와 종료 코드 2)

### Security
- 검수 9항목의 화면 확인(`--serve-url`)이 이 머신 주소(`localhost`·`127.0.0.0/8`·`[::1]`)만 읽는다. 다른 주소는 `serving.not_local` 로 실패한다
- `wb-art --slug` 가 경로 구분자와 `..` 을 거부한다(아티팩트 폴더 밖 쓰기 방지)
- 되돌림 지시서와 `wb-check lane` 이 레인 이름을 검사한다(경로 순회 방지)
- 색인 복사에서 따옴표·제어 문자가 든 경로는 `sqlite3 .backup` 대신 파일 복사를 쓴다
- 자동 재개 로그(재개한 세션의 출력)를 본인만 읽을 수 있게 만든다(폴더 0700, 파일 0600)
