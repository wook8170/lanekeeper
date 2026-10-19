# 시작하기

wb 는 Claude Code 에서 여러 서브에이전트에게 일을 나눠 맡길 때 지켜야 할 규칙을 설정 파일과 훅으로 관리하는 플러그인이다. 작업 종류에 맞는 모델을 고르게 하고, 레인이 보호 브랜치에 커밋하거나 다른 작업의 서버를 끄지 못하게 막는다. 레인이 끝나면 검수 항목과 보고 파일로 결과를 확인한다.

이 문서는 설치, 프로젝트 초기화, 그리고 작은 화면 기능 하나를 브리프부터 보고까지 처리하는 첫 30분을 순서대로 설명한다. 각 단계에는 실제 명령과 그 명령이 출력하는 내용을 함께 적었다. 출력 예시의 경로는 `~/work/list-app` 으로 바꿔 적었다.

## 용어

| 용어 | 뜻 |
|---|---|
| 레인 | 서브에이전트 하나가 맡아 따로 진행하는 작업. 레인마다 자기 브랜치와 작업 폴더(워크트리)를 쓴다 |
| 웨이브 | 함께 진행한 뒤 한 번에 합치는 레인 묶음 |
| 통합 브랜치 | 레인 결과를 모으는 브랜치. 기본 이름 규칙은 `wb/*/int` 이다 |
| 취합 담당 | 레인 결과를 검수해 통합 브랜치에 합치는 메인 세션 |
| 지시서 | 레인에 보내는 작업 지시 문서. 첫 줄에 표지(`<!-- wb-brief v1 … -->`)가 있다 |
| 소유자 | 저장소를 관리하는 사람. 보호 브랜치 반영을 허가한다 |
| 게이트 | 합치기 전에 돌리는 전체 검증 명령 |

## 1. 준비물

| 항목 | 필요 여부 | 용도 |
|---|---|---|
| Claude Code | 필수 | 플러그인 실행. 이 문서는 2.1.302 판에서 확인했다 |
| Node.js 18 이상 | 필수 | 훅과 `wb-*` 명령 실행 |
| git | 필수 | 브랜치·워크트리 판정 |
| Python 3.8 이상과 openpyxl | 선택 | 시험 결과 엑셀, 결함 대장 엑셀 |
| codegraph | 선택 | 코드 색인. 없으면 관련 훅이 아무것도 하지 않는다 |
| cwebp 또는 Python Pillow | 선택 | 보고용 큰 PNG 를 WebP 로 줄임 |

openpyxl 설치는 환경마다 다르다. Debian·Ubuntu 는 `sudo apt install python3-openpyxl` 을 쓴다. Homebrew Python, Debian 12 이상, Ubuntu 24.04 처럼 시스템 Python 에 pip 설치가 막힌 환경에서는 가상환경을 만든다.

```
python3 -m venv ~/.wb/venv
~/.wb/venv/bin/pip install openpyxl
export WB_PYTHON=$HOME/.wb/venv/bin/python3
```

`wb-test-report env` 로 준비 여부를 확인한다. Linux 에 `lsof` 가 없어도 `/proc` 로 대신 확인하므로 따로 설치하지 않아도 된다.

## 2. 설치

### 2.1 마켓플레이스에서 설치

터미널에서 마켓플레이스를 추가하고 플러그인을 설치한다. 마켓플레이스 이름은 `wb-plugin`, 플러그인 이름은 `wb` 다.

```
claude plugin marketplace add <저장소 주소>
claude plugin install wb@wb-plugin
```

출력 예시:

```
Adding marketplace…✔ Successfully added marketplace: wb-plugin (declared in user settings)
Installing plugin "wb@wb-plugin"...✔ Successfully installed plugin: wb@wb-plugin (scope: user)
2 userConfig options not yet set — run /plugin configure wb@wb-plugin in Claude Code, or pass --config KEY=VALUE.
```

마지막 줄은 플러그인 설정 화면의 두 값(메시지 언어 `language`, 보고 분량 `chat_detail`)을 아직 고르지 않았다는 안내다. 고르지 않아도 기본값(`auto`, `summary`)으로 동작한다. 고르려면 Claude Code 안에서 `/plugin configure wb@wb-plugin` 을 실행한다.

Claude Code 세션 안에서는 같은 일을 `/plugin marketplace add <저장소 주소>` 와 `/plugin install wb@wb-plugin` 으로 한다.

### 2.2 내려받은 폴더에서 설치

저장소를 내려받은 폴더를 마켓플레이스로 추가할 수도 있다. 이때 플러그인은 그 폴더를 직접 읽으므로, 폴더 내용을 고치면 다음 세션부터 반영된다.

```
claude plugin marketplace add ~/src/wb-plugin
claude plugin install wb@wb-plugin
```

### 2.3 한 세션에서만 써 보기

설치하지 않고 한 세션에서만 불러오려면 `--plugin-dir` 을 쓴다. 세션을 끝내면 플러그인도 빠진다.

```
claude --plugin-dir ~/src/wb-plugin
```

### 2.4 설치 확인

```
claude plugin list
```

```
Installed plugins:

  ❯ wb@wb-plugin
    Version: 0.1.0
    Read from: ~/src/wb-plugin
    Scope: user
    Status: ✔ enabled
```

`wb-config`, `wb-waves` 같은 `wb-*` 명령은 Claude Code 세션 안에서 Claude 가 실행하는 Bash 명령으로 바로 쓸 수 있다. 일반 터미널에서 쓰려면 `claude plugin list` 의 `Read from` 경로 아래 `bin` 폴더를 `PATH` 에 넣는다.

```
export PATH="$HOME/src/wb-plugin/bin:$PATH"
```

## 3. 프로젝트 초기화

프로젝트 폴더는 git 저장소이고 커밋이 하나 이상 있어야 한다. 레인 워크트리는 커밋에서 만들어지므로 커밋이 없으면 `wb-worktree create` 가 첫 커밋을 만들라고 안내하며 멈춘다. 이 폴더에서 Claude Code 를 열고 `/wb:init` 을 입력한다. Claude 가 네 가지를 한 번에 묻는다.

| 질문 | 선택지 | 쓰는 곳 |
|---|---|---|
| 프로젝트 종류 | `web-ui`(화면이 있음) · `service` · `library` · `other` | `project.project_kind`. 검수에서 화면 변경을 가릴 때 쓴다 |
| 메시지 언어 | `ko` · `en` | `personal.language` |
| 전체 검증 명령 | 예: `npm test`. 비워 둘 수 있다 | `project.gate.command` |
| Claude Code 가 만드는 워크트리도 wb 가 관리할지 | `no`(기본) · `yes` | `project.worktree.hook`. 자세한 내용은 [기능 안내](02-features.md)의 「레인 워크트리」 |

답을 받으면 Claude 가 다음 명령을 실행한다. 직접 실행해도 결과는 같다.

```
wb-config init --kind web-ui --lang ko --gate "npm test" --worktree-hook no
```

```
작성: ~/work/list-app/.wb/config.json
작성: ~/.wb/personal.json
추가: ~/work/list-app/.git/info/exclude 에 `.wb/briefs/`
추가: ~/work/list-app/.git/info/exclude 에 `.codegraph/`
추가: ~/work/list-app/.git/info/exclude 에 `.wb/metrics/`
초기화를 마쳤습니다. `/wb:doctor` 로 결과를 확인하세요.
```

init 이 하는 일은 다음과 같다.

- `.wb/config.json`(프로젝트 설정)과 `~/.wb/personal.json`(개인 설정)을 만든다. 이미 있는 파일은 덮어쓰지 않고 `유지:` 로 알린다.
- `.git/info/exclude` 에 `.wb/briefs/`, `.codegraph/`, `.wb/metrics/` 를 넣어 git 상태에 나타나지 않게 한다.
- 커밋은 하지 않는다. `.wb/config.json` 은 팀이 함께 쓰는 설정이므로 커밋한다.

결과는 `/wb:doctor`(또는 `wb-config doctor`)로 확인한다.

```
wb 점검
✓ Node.js 22.22.2: 정상
✓ git 저장소 (~/work/list-app): 정상
✓ 프로젝트 설정 .wb/config.json: 정상
✓ 설정 해석: 정상
✓ codegraph: 정상
! 이 체크아웃의 codegraph 색인: 확인 필요 — 없어요 — `wb-index add .` 로 만들 수 있어요
✓ 색인 대기열: 정상 — 대기 0 · 진행 0 · 최근 실패 0
✓ 남은 색인: 정상
주요 값과 출처:
  personal.language = "ko"  [개인]
  personal.report.chat_detail = "summary"  [기본값]
  routing.denied = []  [기본값]
  machine.lanes.max = 3  [기본값]
  machine.slots.heavy.count = 2  [기본값]
  machine.slots.browser.count = 2  [기본값]
  machine.load.max = "auto"  [기본값]
  project.project_kind = "web-ui"  [프로젝트]
  project.git.protected_branches = ["main","master","release/*"]  [기본값]
  (effective) language = ko, load.max = 20
```

`✗` 줄이 있으면 [문제 해결](05-troubleshooting.md)을 본다. codegraph 가 설치돼 있지 않으면 codegraph 줄이 안내로 바뀌며, wb 의 다른 기능은 그대로 쓸 수 있다.

## 4. 처음 30분 따라 하기

예시 작업은 「목록 화면에 검색 상자 추가」다. 화면 파일 `src/List.tsx` 하나와 시험 파일이 있는 작은 앱에서, 레인 하나로 브리프 → 시안 → 레인 → 검수 → 취합 → 보고 → 인계까지 진행한다.

| 단계 | 사용자가 하는 일 | Claude 가 실행하는 주요 명령 | 결과 |
|---|---|---|---|
| 1 준비 | 통합 브랜치와 화면 파일 범위를 정한다 | `git switch -c`, 설정 편집 | 통합 브랜치 `wb/search/int` |
| 2 브리프 | `/wb:work` 로 요청을 한 줄 입력한다 | `wb-work plan` | 요청 종류와 단계별 모델 |
| 3 시안 | 시안을 보고 하나를 고른다 | `wb-decide new`, `wb-decide answer` | 결정 문서 `docs/decisions/…` |
| 4 레인 준비 | 없음 | `wb-worktree create`, `wb-style brief`, `wb-check brief`, `wb-waves lane` | 레인 워크트리와 지시서 |
| 5 레인 실행 | 진행판을 본다 | Agent 도구 호출, `wb-waves board` | 레인 브랜치 커밋과 보고 파일 |
| 6 검수 | 되돌림을 보낼지 정한다 | `wb-check lane` | 9항목 판정 |
| 7 취합 | 없음 | `wb-integrate`, `wb-test-report run` | 통합 브랜치 병합, 시험 결과 엑셀 |
| 8 보고 | 보고 페이지를 연다 | `wb-art report` | 전후 캡처가 든 보고 HTML |
| 9 인계 | `/clear` 로 세션을 정리한다 | `wb-waves handoff archive` | `progress.md` 와 아카이브 |

### 4.1 준비: 통합 브랜치와 화면 파일 범위

레인 결과를 모을 통합 브랜치를 만든다. 이름은 `project.git.integration_branch_pattern`(기본 `wb/*/int`)에 맞춘다. 보호 브랜치(`main` 등)에는 레인 결과를 직접 합치지 않는다.

```
git switch -c wb/search/int
```

시안 먼저 규칙은 화면 파일 범위가 정해져 있을 때만 동작한다. `.wb/config.json` 에 범위를 넣고 커밋한다.

```json
{
  "version": 1,
  "project_kind": "web-ui",
  "gate": { "command": "npm test", "verify_all": "", "append_checks": [] },
  "mockup": { "ui_globs": ["src/**/*.tsx"] }
}
```

### 4.2 브리프: 요청을 단계로 나누기

Claude Code 에 다음과 같이 입력한다.

```
/wb:work 목록 화면에 검색 상자 추가
```

Claude 는 요청을 한 문장으로 다시 정리해 확인을 받은 뒤, `wb-work plan` 으로 요청 종류와 단계를 정한다.

```
wb-work plan "목록 화면에 검색 상자 추가"
```

```
요청 종류: 화면 변경
  1. 요청을 한 문장으로 정리해 사용자에게 확인받는다
  2. 시안 레인이 현재 화면과 제안 화면을 만든다 (모델 opus)
  3. 시안을 보고 소유자가 선택한다 (`/wb:decide`)
  4. 구현 레인이 지시서대로 만든다 (모델 opus)
  5. 다른 모델이 새 문맥에서 검수한다 (모델 fable)
  6. 검수를 통과한 레인을 통합 브랜치에 합친다
  7. 결과를 보고한다. 확인한 것과 남은 것을 나눠 적는다
  8. `progress.md` 를 갱신하고 `/clear` 를 안내한다
```

각 단계의 모델은 `routing.json` 의 라우팅 결과다. 개인 설정에서 금지한 모델이나 사용 한도에 걸린 모델은 빠지고 다음 모델이 표시된다. 「HH:MM 까지 대기」가 나오면 해당 등급의 모델이 모두 한도에 걸린 상태다.

진행 위치는 언제든 `wb-work progress` 로 본다.

```
[■□□□□□□] 1/7 요청 확인 · 레인 없음
```

### 4.3 시안: 현재 화면과 대안을 보고 고르기

시안 결정 없이 화면 구조를 바꾸려고 하면 시안 먼저 훅이 쓰기를 막는다. 예를 들어 Claude 가 `src/List.tsx` 에 검색 입력 요소를 넣으려 하면 다음 메시지가 나온다.

```
[wb] 막았습니다: src/List.tsx 의 UI 구조(요소·선택자)가 바뀌는데 기록된 시안 결정이 없습니다
이렇게 고치세요: 시안(현재 화면과 대안)을 아티팩트로 먼저 보여 주고 `wb-decide new <slug> --kind mockup --scope src/List.tsx …` 로 결정 문서를 만든 뒤, 오너의 선택을 `wb-decide answer` 로 기록하세요(docs/decisions). …
물어볼 곳: README 의 「시안 먼저」 절. 이 검사를 끄려면 .wb/config.json 의 mockup.decision_required 를 false 로 바꿉니다(저장소 소유자 결정).
```

Claude 는 시안 레인으로 현재 화면과 대안 시안을 만들어 보여 주고, 결정 질문을 문서로 만든다.

```
wb-decide new list-search --kind mockup --scope "src/**/*.tsx" \
  --title "목록 화면 검색 상자 위치" --question "검색 상자를 어디에 둘까요?" \
  --option "A=목록 위 전체 폭" --option "B=목록 오른쪽 위 작은 상자" --recommend A
```

```
결정 요청을 만들었어요: docs/decisions/2026-10-17-list-search.md
커밋 제안: `git add docs/decisions/2026-10-17-list-search.md` 후 커밋하세요. 자동으로 커밋하지 않아요.
```

사용자가 A 를 고르면 Claude 가 답을 기록한다.

```
wb-decide answer list-search --choice "A. 목록 위 전체 폭" --note "검색이 주 동작이라 눈에 띄게"
```

```
결정을 기록했어요: docs/decisions/2026-10-17-list-search.md
커밋 제안: `git add docs/decisions/2026-10-17-list-search.md` 후 커밋하세요. 자동으로 커밋하지 않아요.
```

결정 문서의 첫 줄이 `<!-- wb-decision v1 status=decided kind=mockup scope=src/**/*.tsx -->` 로 바뀌면 그 범위의 화면 파일 쓰기가 풀린다. 레인 워크트리는 통합 브랜치 HEAD 에서 만들어지므로, 레인을 만들기 전에 결정 문서를 통합 브랜치에 커밋한다. 커밋하지 않으면 레인 워크트리에 결정 문서가 없다.

### 4.4 레인 준비: 워크트리와 지시서

웨이브를 만들고 레인 워크트리를 만든다.

```
wb-waves init-wave w1 --title "목록 검색 상자"
wb-worktree create l1
```

```
웨이브 w1 를 만들었습니다.
레인 l1 워크트리를 만들었습니다: ~/work/wt-l1 (브랜치 wb/search/l1, 기준 wb/search/int 06a6d7da9)
포트: web=41000 web2=41001 api=41002 db=41003 aux=41004
codegraph 색인 대기열에 넣었어요(`wb-index status`).
```

레인 브랜치 이름은 통합 브랜치 이름의 마지막 부분을 레인 이름으로 바꾼 것이다. 포트는 레인마다 따로 빌려 준 번호이며, 레인은 이 포트에서만 서버를 띄운다.

지시서는 `templates/briefs/` 의 틀에서 만든다. 문체 줄(`{{style}}`)은 `wb-style brief` 가 채우고, 나머지 자리는 `--var` 로 채운다. 지시서 폴더는 init 이 만들지 않으므로 처음 한 번 만든다.

```
mkdir -p .wb/briefs
wb-style brief impl --owned src/List.tsx,src/list.test.mjs \
  --var lane=l1 --var title="목록 검색 상자" \
  --var worktree=~/work/wt-l1 --var branch=wb/search/l1 --var base_sha=06a6d7d \
  --var read_first="docs/decisions/2026-10-17-list-search.md" \
  --var goal="목록 위에 전체 폭 검색 상자를 두고 입력한 글자가 들어간 항목만 보여 준다." \
  --var owned_files="src/List.tsx, src/list.test.mjs" \
  --var acceptance="검색어를 입력하면 일치하는 항목만 남는다" \
  --var report_path="~/.wb-scratch/list-app/reports/l1.md" \
  --var trailer="Co-Authored-By: Claude <noreply@anthropic.com>" > .wb/briefs/l1.md
wb-check brief .wb/briefs/l1.md
```

```
지시서 점검 통과: .wb/briefs/l1.md
  type=impl-multi lane=l1 template=impl
```

채우지 않은 자리가 남아 있으면 점검이 실패하고 종료 코드 1 을 돌려준다.

```
지시서 점검 실패: .wb/briefs/l1.md
  ✗ {{style}}
  type=impl-multi lane=l1 template=impl
```

마지막으로 레인을 원장에 등록한다.

```
wb-waves lane w1 l1 --task impl-multi --model opus --brief .wb/briefs/l1.md \
  --todo "검색 상자 추가" --todo "필터 시험"
```

```
웨이브 w1 에 레인 l1 을 추가했습니다.
```

### 4.5 레인 실행

Claude 가 Agent 도구로 지시서를 보낸다. 디스패치 검사 훅이 지시서 표지와 모델을 확인한다. `model` 을 빠뜨리면 다음처럼 막힌다.

```
[wb] 막았습니다: model 이 지정되지 않았습니다. 작업 종류 `impl-multi` 의 라우팅 결과는 `opus` 입니다.
이렇게 고치세요: Agent 호출에 model: "opus" 을 지정하세요.
라우팅: impl-multi → opus
```

최소 등급보다 낮은 모델을 고르면 다음처럼 막힌다.

```
[wb] 막았습니다: model `haiku` 은 작업 종류 `impl-multi` 의 바닥선 `sonnet` 보다 낮습니다.
이렇게 고치세요: `opus` 을 쓰세요. 바닥선 아래로는 내리지 않습니다.
```

올바른 모델로 보내면 훅은 아무것도 출력하지 않고 통과시킨다. 레인이 도는 동안 진행판으로 상태를 본다.

```
wb-waves board
```

```
wave/lane  상태   모델  작업        실행/되돌림  할 일  통과/실패  토큰  경과
w1/l1      진행*  opus  impl-multi  1/0          0/2    0/0        0     0m

진행 1  (* = 에이전트 실행 중)
```

레인은 자기 레인 브랜치에만 커밋하고, 지시서에 적힌 보고 파일에 결과를 쓴다. 레인이 끝나면 상태가 「검수 대기」로 바뀐다.

```
[■■■■□□□] 4/7 검수 · 검수 대기 1
```

레인 보고 파일에는 새 HEAD, 시험 결과, 남은 것을 적는다. 검수는 이 파일을 정본으로 읽는다. 시험 결과는 `시험: 통과 12 / 실패 0` 처럼 한 줄로 쓴다. 수정 전 실패 기록은 `수정 전 실패 1건` 처럼 따로 적으며, 검수는 이 기록을 실패로 세지 않는다.

```
# l1 보고 — 목록 검색 상자

- 새 HEAD: c968ed5
- 인수 기준 1(검색어를 입력하면 일치하는 항목만 남는다): 완료
- 바꾼 파일: src/List.tsx, src/list.test.mjs
- 수정 전 실패: 필터 시험을 먼저 추가해 실패를 확인함
- 시험: node --test src/list.test.mjs — 1건 통과
- 캡처: cap/before.png, cap/after.png
- 남은 것: 없음
```

### 4.6 검수

`/wb:review-lane` 을 실행하면 Claude 가 `wb-check lane` 으로 9항목을 판정한다. 화면 변경이므로 캡처를 직접 열어 본 뒤 `--captures-seen` 을 붙이고, 서빙 중인 코드에 이번 변경의 표식(`list-search` 클래스 이름)이 있는지도 확인한다.

```
wb-check lane l1 --report ~/.wb-scratch/list-app/reports/l1.md \
  --return ~/.wb-scratch/list-app/reports/l1.return.txt --brief .wb/briefs/l1.md \
  --lane-dir ~/work/wt-l1 --captures-seen \
  --serve-url http://127.0.0.1:41000/src/List.tsx --marker list-search --wave w1 --record
```

```
레인 l1 검수: 통과
  ✓ 1. 보고 HEAD — HEAD c968ed5125a0, 통합 HEAD 06a6d7da9908 기준
  ✓ 2. 보고 파일 — l1.md 필수 항목 채움
  – 3. 프로젝트 가드 — 설정된 가드 없음(project.review.guards)
  ✓ 4. 수정 전 실패 기록 — 수정 전 실패 기록 있음
  ✓ 5. 지시서 범위 — 바뀐 파일 2개 모두 범위 안
  ✓ 6. 캡처 확인 — 캡처 2개 확인
  ✓ 7. 서빙 코드 표식 — http://127.0.0.1:41000/src/List.tsx 에 표식 있음
  ✓ 8. 시험 결과 — 시험 1건 통과 보고
  – 9. 용어 — 용어 사전이 없어 건너뜀
```

아래는 첫 검수 결과다. 캡처와 서빙 주소를 넘기지 않았고, 보고 파일에 시험 결과를 「통과 1 / 실패 0」으로 적어 통과 수를 읽지 못했다.

```
레인 l1 검수: 실패 3건
  ✓ 1. 보고 HEAD — HEAD c968ed5125a0, 통합 HEAD 06a6d7da9908 기준
  ✓ 2. 보고 파일 — l1.md 필수 항목 채움
  – 3. 프로젝트 가드 — 설정된 가드 없음(project.review.guards)
  ✓ 4. 수정 전 실패 기록 — 수정 전 실패 기록 있음
  ✓ 5. 지시서 범위 — 바뀐 파일 2개 모두 범위 안
  ✗ 6. 캡처 확인 — UI 변경인데 캡처가 없습니다
  ✗ 7. 서빙 코드 표식 — 웹 UI 변경인데 확인할 주소(--serve-url)와 표식(--marker)이 없습니다
  ✗ 8. 시험 결과 — 보고에 시험 결과(통과 수)가 없습니다
  – 9. 용어 — 용어 사전이 없어 건너뜀
되돌림 지시서: .wb/briefs/l1-return-1.md
```

Claude 는 실패 항목을 보여 주고 되돌림 지시서를 같은 레인에 보낼지 묻는다. 되돌림 지시서도 디스패치 검사를 통과하는 형식이다. `--record` 를 주면 통과는 「완료」, 실패는 되돌림 1회로 원장에 남는다.

### 4.7 취합

통합 브랜치를 체크아웃한 폴더에서 `/wb:integrate` 를 실행한다. 큰 레인은 먼저 시험 병합으로 확인한다.

```
wb-integrate wb/search/l1 --dry-run
wb-integrate wb/search/l1 --lane l1 --wave w1 --trailer "Co-Authored-By: Claude <noreply@anthropic.com>"
```

```
wb/search/l1 시험 병합 통과(커밋하지 않고 되돌림)
wb/search/l1 를 병합했습니다. 새 HEAD b572a921d734
```

웨이브의 레인을 모두 합친 뒤 전체 검증을 한 번 돌리고 결과를 엑셀로 남긴다(`/wb:test-report`). 처음에는 `wb-test-report init` 이 만든 `.wb/verify.config.json` 의 단계 목록을 프로젝트에 맞게 고친다. 아래는 pytest 단계 하나를 둔 예다.

```json
{
  "version": 1,
  "gate": { "script": "gate", "skip_in_verify": ["test"], "slot": "heavy" },
  "stages": [
    { "name": "unit", "adapter": "pytest", "kind": "unit", "suite": "app",
      "cmd": "python3 -m pytest tests -q --junitxml={file}", "slot": "heavy" }
  ]
}
```

`gate.script` 는 프로젝트 `package.json` 의 `scripts` 에 있는 이름이다. 그 스크립트가 `&&` 로 이은 명령을 한 단계씩 실행한다. 이 이름의 스크립트가 없으면 `wb-test-report run` 이 안내 메시지를 내고 멈춘다. 스크립트 대신 `"gate": { "steps": [{ "name": "test", "cmd": "npm test" }] }` 처럼 명령을 직접 적어도 된다. `skip_in_verify` 에 적은 단계는 게이트에서 빼고 `stages` 가 따로 실행한다.

```
wb-test-report run --name integration
```

```
[gate 1/1] node --test src/list.test.mjs
[wb-slot] 슬롯 heavy#1 에서 실행합니다: sh -c node --test src/list.test.mjs
…
[gate] 1 steps · passed 1 · failed 0 · …/gate.json
[wb-slot] 슬롯 heavy#1 에서 실행합니다: sh -c python3 -m pytest tests -q --junitxml=…
2 passed in 0.01s
~/work/list-app/docs/test-results/2026-10-17/integration-2238.xlsx: 판정 통과 · 스위트 1 · gate 1단계 · 실패 0 · 간헐 0 · 원장 불일치 0 · 시험 행 0

[verify] 결과 폴더 ~/work/list-app/test-results/runs/integration-20261017-2238 · 실패 단계 없음
게이트 통과 표식을 남겼습니다: 커밋 425ace6… · ~/work/list-app/.git/wb/wb-gate-pass.json
```

엑셀 파일 이름의 날짜와 시각은 실행을 시작한 현지 시각(시스템 시간대)이다. 게이트와 모든 단계가 통과하고 커밋하지 않은 변경이 없으면 게이트 통과 표식을 남긴다. 표식은 4.10 절의 보호 브랜치 반영에 쓰인다.

엑셀과 같은 이름의 `.json` 을 커밋하고 `wb-check test-results` 로 확인한다. 원본 로그 폴더(`test-results/runs/`)는 커밋하지 않으므로 `.gitignore` 에 `/test-results/` 처럼 저장소 맨 위 폴더만 가리키는 줄을 넣는다. `test-results/` 로 적으면 `docs/test-results/` 까지 가려진다.

```
시험 결과 점검 통과.
  ✓ 최신 결과 엑셀: docs/test-results/2026-10-17/integration-2238.xlsx
  ✓ 커밋됨: docs/test-results/2026-10-17/integration-2238.xlsx
  ✓ 종합 판정: passed
  ✓ 실행 커밋 425ace6 뒤로는 시험 결과 파일만 바뀌었습니다(현재 HEAD 599d4cd). 같은 결과로 봅니다.
```

결과 파일을 커밋하면 HEAD 가 바뀌지만, 그 뒤로 결과 폴더 밖의 파일이 바뀌지 않았으면 같은 실행으로 본다. 코드가 바뀌었으면 `실행 커밋 … 이 현재 HEAD … 와 다릅니다` 경고가 나오고 다시 돌려야 한다.

### 4.8 보고

`/wb:report` 를 실행하면 Claude 가 시험 결과, 결함 대장, 전후 캡처를 묶어 보고 페이지를 만들고 아티팩트로 게시한다. 이미지는 HTML 안에 넣기 때문에 원격 기기에서도 보인다.

```
wb-art report --title "목록 검색 상자" --md body.md \
  --image "전=cap/before.png" --image "후=cap/after.png" --slug list-search
```

```
보고 HTML: ~/.wb-scratch/list-app/art/list-search/index.html (4KB, 이미지 2개 포함)
```

다시 볼 캡처는 `wb-art keep <png> --slug list-search` 로 `docs/reports/artifacts/list-search/` 에 두고 커밋한다. 보고 단계가 아티팩트 없이 끝나려 하면 Stop 훅이 한 번 막는다.

보고는 「병합 준비 완료」에서 멈춘다. 보호 브랜치(`main`)에 합치는 것은 소유자가 정한다.

### 4.9 인계와 정리

`progress.md` 가 있는 저장소에서는 마지막 갱신 뒤에 커밋이나 파일 변경이 생기면 턴 종료 때 Stop 훅이 한 번 막고 인계를 요구한다. `progress.md` 를 처음 만드는 것은 사람이나 Claude 의 몫이고, 그 뒤로는 훅이 갱신을 챙긴다.

```
[wb 핸드오프] progress.md 마지막 갱신 이후의 작업(커밋 또는 변경된 파일)이 있다. 핸드오프를 갱신한 뒤 종료한다. …
```

끝난 내용은 월별 아카이브로 옮기고 `progress.md` 는 현재 상태로 다시 쓴다.

```
wb-waves handoff archive "W1 목록 검색 상자 완료"
```

```
아카이브에 덧붙였습니다: docs/progress-archive/progress-2026-10.md
이제 progress.md 을 현재 상태로 통째로 다시 쓰고, 아카이브 파일과 함께 커밋하십시오.
```

두 파일을 함께 커밋하고 `/clear` 로 세션을 정리한다. 다음 세션은 `/wb:pickup` 으로 이어받는다.

끝난 레인 워크트리는 지운다. 그 폴더 안에서 도는 프로세스가 있으면 PID 목록을 보여 주고 지우지 않는다.

```
wb-worktree remove l1 --delete-branch
```

```
워크트리를 지웠습니다: ~/work/wt-l1 (포트 반납 1건, 대장 제거 l1, 브랜치 삭제 wb/search/l1)
```

### 4.10 보호 브랜치 반영

`main` 같은 보호 브랜치에 병합·push 하려면 소유자가 프롬프트에 직접 입력해야 한다.

```
/wb:approve merge-main wb/search/int
```

```
[wb] 소유자 허가를 기록했습니다: merge-main · wb/search/int · 커밋 2c2d39f56 · 15분(만료 2026-10-17 22:55 (UTC+09:00)) · 1회. 이 커밋이 아니면 반영되지 않습니다. 게이트 통과 표식도 같은 커밋으로 있어야 합니다: …/.git/wb/wb-gate-pass.json
```

허가는 15분 동안 한 번, 입력할 때의 커밋에만 유효하다. 만료 시각은 이 머신의 현지 시각으로 표시된다. `project.gate.command` 를 설정한 프로젝트는 같은 커밋의 게이트 통과 표식도 필요하다. 표식은 4.7 절의 `wb-test-report run` 이 전체 통과 때 남긴다. 검증 설정(`.wb/verify.config.json`) 없이 게이트 명령만 정한 프로젝트는 통합 브랜치 폴더에서 `wb-test-report gate-pass` 를 실행한다. 이 명령은 `project.gate.command` 를 실행하고, 통과하면 표식을 남긴다.

```
wb-test-report gate-pass
```

```
게이트 실행: npm test
…
게이트 통과 표식을 남겼습니다: 커밋 2c2d39f56 · ~/work/list-app/.git/wb/wb-gate-pass.json
```

표식을 남긴 뒤 결과 파일만 커밋했다면 표식은 그대로 유효하다. 다른 변경이 들어가면 병합이 `게이트 통과 표식이 다른 커밋(…)의 것입니다` 로 막히므로 다시 돌린다.

## 다음에 읽을 문서

- [기능 안내](02-features.md): 기능별 사용법과 스킬 26개
- [설정](03-configuration.md): 설정 층과 키 전체
- [규칙 안내](04-rules.md): 규칙 41개와 막혔을 때 고치는 법
- [문제 해결](05-troubleshooting.md): 자주 나오는 메시지와 질문
