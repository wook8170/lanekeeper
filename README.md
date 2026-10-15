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

설치한 뒤 프로젝트 폴더에서 `/wb:init` 을 실행한다. 세 가지를 묻는다.

1. 프로젝트 종류(`web-ui` · `service` · `library` · `other`)
2. 메시지 언어(`ko` · `en`)
3. 전체 검증 명령(없으면 비워 둔다)

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
| 체크포인트 | 한도, 서브에이전트 종료, 컨텍스트 압축 시점에 레인 브랜치의 미커밋 변경을 `wip(wb)` 커밋으로 남긴다. 보호 브랜치와 레인이 아닌 브랜치는 건드리지 않고 push 하지 않는다 | `personal.checkpoint.enabled` | |

자동 재개의 권한 모드 기본값은 `default` 다. 이 모드에서는 승인이 필요한 도구가 무인 실행에서 거절되므로, 재개한 작업이 그 지점에서 멈출 수 있다. `bypassPermissions` 는 `wb-retry mode bypassPermissions --i-understand` 로 위험을 확인한 뒤에만 켜지고, 확인 기록(`bypass_ack`)이 없으면 `default` 로 재개한다.

토큰 가드의 예산은 기본이 0(미보정)이며 이 상태에서는 동작하지 않는다. 앱에서 한도에 도달했을 때 `wb-token calibrate` 를 실행하면 그 시점의 사용량이 예산으로 기록된다. 집계 대상은 이 기기의 Claude Code 사용뿐이고 비율은 추정치다.

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
