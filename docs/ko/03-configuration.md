# 설정

wb 의 설정은 파일 네 층으로 나뉜다. 팀이 함께 정할 값은 저장소에 커밋하는 프로젝트 설정에 두고, 머신 사양과 개인 선호는 커밋하지 않는 홈 폴더 파일에 둔다. 이 문서는 층별 파일, 값을 합치는 규칙, 키 전체의 기본값과 뜻을 정리했다.

## 1. 설정 층

| 층 | 파일 | git 추적 | 담는 것 |
|---|---|---|---|
| 기본값 | 플러그인 `defaults/config.json`, `machine.json`, `personal.json`, `routing.json` | 플러그인 저장소 | 모든 키의 기본값 |
| 프로젝트 | `<저장소>/.wb/config.json` | 커밋 | 프로젝트 종류, 브랜치 규칙, 저장 위치, 검증 명령, 문체 지도 |
| 머신 | `~/.wb/machine.json` | 안 함 | 레인 수, 실행 슬롯, 부하 문턱, 보호 포트, 레인 포트 대역 |
| 플러그인 설정 화면 | `/plugin configure wb@wb-plugin` | 안 함 | 메시지 언어, 보고 분량. 훅 실행 때만 읽힌다 |
| 개인 | `~/.wb/routing.json`, `~/.wb/personal.json` | 안 함 | 모델 라우팅과 금지 모델, 언어, 보고 분량, 자동 재개, 인계, 토큰 가드 |

프로젝트 설정 파일의 최상위 키는 `project` 영역이다. 같은 파일에 `machine`, `personal`, `routing` 절을 두면 그 영역의 값으로 읽는다. 예를 들어 프로젝트가 레인 수를 2 로 낮추려면 `.wb/config.json` 에 `"machine": { "lanes": { "max": 2 } }` 를 둔다.

`~/.wb` 대신 다른 폴더를 쓰려면 환경 변수 `WB_HOME` 을 지정한다. 예시 파일은 플러그인의 `examples/` 에 있다.

## 2. 값을 합치는 규칙

| 키 종류 | 규칙 | 해당 키 |
|---|---|---|
| 일반 값 | 높은 층이 덮어쓴다. 개인 > 플러그인 설정 화면 > 머신 > 프로젝트 > 기본값 | 아래 두 줄을 뺀 모든 키 |
| 보호 목록 | 모든 층의 합집합. 어느 층도 다른 층이 넣은 항목을 지울 수 없다 | `routing.denied`, `machine.ports.protected`, `project.git.protected_branches`, `project.protected_paths` |
| 상한 | 기본값을 뺀 층 중 가장 작은 값. 다른 층에 값이 없을 때만 기본값을 쓴다 | `machine.lanes.max`, `machine.slots.heavy.count`, `machine.slots.browser.count`, `machine.load.max` |

상한 규칙에서 기본값을 빼는 이유는 개인 머신 파일이 기본값(레인 3개)보다 큰 값을 쓸 수 있게 하기 위해서다. 프로젝트는 그 값을 더 낮출 수만 있다.

## 3. 설정 확인 명령

```
wb-config get <키>          합친 값
wb-config explain <키>      합치는 규칙, 적용된 층, 값을 둔 모든 층
wb-config validate          파일별 형식 검사. 오류가 있으면 종료 코드 1
wb-config dump              합친 설정 전체
wb-config doctor            점검과 주요 값의 출처
```

모르는 키는 무시하고 경고로만 알린다. 형식이 틀린 값은 오류이며, 설정에 오류가 있는 동안 안전 훅은 git 반영·프로세스 종료·삭제·브라우저 실행을 막는다.

```
wb-config validate
설정에 오류가 없습니다.
```

## 4. 키 참조

표의 기본값은 JSON 으로 적었다. 「예약」 표시가 있는 키는 형식 검사만 하고 0.1.0 의 명령과 훅은 읽지 않는다. 「스킬 참고」 표시가 있는 키는 명령이 직접 읽지 않고 스킬 안내에서 Claude 가 참고한다.

### 4.1 모델 라우팅(`routing`)

개인 파일 `~/.wb/routing.json` 에 둔다.

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `routing.version` | `1` | 파일 형식 판 | `1` |
| `routing.models` | 아래 설명 | 모델 이름별 Agent 도구 값(`agent_param`)과 등급(`rank`). 등급이 클수록 높다 | `{"opus":{"agent_param":"opus","rank":3}}` |
| `routing.denied` | `[]` | 쓰지 않을 모델. 보호 목록 규칙으로 합친다 | `["fable"]` |
| `routing.denied_note` | `{}` | 금지 이유 메모(스킬 참고) | `{"fable":"개인 결정"}` |
| `routing.tasks` | 아래 설명 | 작업 종류별 `label`, `chain`(대체 순서), `floor`(최소 등급), `on_floor`(`wait-notify`), `differ_from`(`implementer`) | `{"review":{"chain":["opus"]}}` |
| `routing.limits_state` | `"${CLAUDE_PLUGIN_DATA}/limits.json"` | 사용 한도에 걸린 모델 기록 파일 | 기본값 유지 |

`routing.models` 의 기본값은 fable(등급 4), opus(3), sonnet(2), haiku(1)이다. `routing.tasks` 의 기본값 10종은 [기능 안내](02-features.md) 2절의 표와 같다. 작업 종류 하나만 바꿀 때는 그 항목의 바꿀 키만 적는다.

```json
{
  "version": 1,
  "denied": ["fable"],
  "denied_note": { "fable": "개인 결정. 지우면 다시 쓴다" },
  "tasks": { "review": { "chain": ["opus"] } }
}
```

### 4.2 머신(`machine`)

개인 파일 `~/.wb/machine.json` 에 둔다. 포트 숫자는 이 파일에만 둔다.

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `machine.version` | `1` | 파일 형식 판 | `1` |
| `machine.lanes.max` | `3` | 동시에 살아 있을 수 있는 레인 수. 상한 규칙 | `6` |
| `machine.load.max` | `"auto"` | 이 1분 부하 이상이면 슬롯 실행을 기다린다. `auto` 는 논리 코어 수 × 2. 상한 규칙 | `16` |
| `machine.load.auto_rule` | `"logical_cores * 2"` | `auto` 계산식 설명(예약) | 기본값 유지 |
| `machine.load.sample` | `"1min"` | 비교할 부하 평균. `1min` · `5min` · `15min` | `"5min"` |
| `machine.slots.heavy.count` | `2` | 무거운 실행 슬롯 수. 상한 규칙 | `3` |
| `machine.slots.heavy.patterns` | `["full-test","e2e","typecheck-all","build","install","codegraph-index"]` | 무거운 실행으로 볼 패턴 묶음 이름(`defaults/heavy-patterns.json`) | `["full-test","e2e"]` |
| `machine.slots.browser.count` | `2` | 브라우저 슬롯 수. 상한 규칙 | `1` |
| `machine.slots.browser.patterns` | `["chrome-headless","playwright","cdp"]` | 브라우저 실행으로 볼 패턴 묶음 이름 | `["playwright"]` |
| `machine.slots.lease_dir` | `"~/.wb/run/slots"` | 슬롯 임대 파일 폴더 | 기본값 유지 |
| `machine.slots.stale_after_min` | `90` | 이 시간(분) 동안 갱신이 없는 임대를 회수 | `120` |
| `machine.slots.guard` | `"warn"` | 슬롯 없이 실행한 무거운 명령 처리. `warn` 은 안내, `deny` 는 차단 | `"deny"` |
| `machine.ports.protected` | `[]` | 종료하면 안 되는 포트 목록. 항목은 `name`, `port`, `project`, `note`. 보호 목록 규칙 | `[{"name":"my-api","port":8080,"project":"*"}]` |
| `machine.ports.lane_range.base` | `41000` | 레인 포트 대역 시작 번호 | `42000` |
| `machine.ports.lane_range.step` | `20` | 레인 하나가 차지하는 포트 칸 수 | `10` |
| `machine.ports.lane_range.per_lane` | `["web","web2","api","db","aux"]` | 레인마다 빌려 주는 포트 이름 | `["web","api"]` |
| `machine.ports.lane_range.max_lanes` | `9` | 대역 안의 최대 레인 수 | `6` |
| `machine.ports.leases` | `"{git_common_dir}/wb/ports.json"` | 포트 임대 대장 위치 | 기본값 유지 |
| `machine.servers` | `[]` | 취합 뒤 다시 띄울 서버 목록. 항목은 `name`, `port_ref`, `restart`, `verify_url_path`(스킬 참고) | `[{"name":"my-web","port_ref":"my-api","restart":"manual"}]` |

### 4.3 개인(`personal`)

개인 파일 `~/.wb/personal.json` 에 둔다. `language` 와 `report.chat_detail` 은 플러그인 설정 화면에서도 고를 수 있으며, 이 파일의 값이 이긴다.

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `personal.version` | `1` | 파일 형식 판 | `1` |
| `personal.language` | `"auto"` | 메시지 언어. `auto` 는 시스템 로캘을 따른다 | `"ko"` |
| `personal.report.chat_detail` | `"summary"` | 채팅 보고 분량. `summary` 는 요약과 아티팩트 링크, `detailed` 는 표·근거·수치까지 채팅에 | `"detailed"` |
| `personal.report.viewer` | `"local"` | 보고를 보는 곳. `remote` 면 원격 기기에서 열 수 있는 형태로 만든다(스킬 참고) | `"remote"` |
| `personal.report.artifact_fallback` | `"html-file"` | 아티팩트 도구가 없을 때 대신 쓸 방식. `html-file` · `none` | `"none"` |
| `personal.report.artifact_check` | `true` | 보고 단계가 아티팩트 없이 끝나면 한 번 막을지 | `false` |
| `personal.auto_retry.enabled` | `true` | 사용 한도 뒤 자동 재개 | `false` |
| `personal.auto_retry.permission_mode` | `"default"` | 재개 세션의 권한 모드. `default` · `acceptEdits` · `plan` · `bypassPermissions` | `"acceptEdits"` |
| `personal.auto_retry.bypass_ack` | `false` | `bypassPermissions` 위험 확인 기록. `wb-retry mode bypassPermissions --i-understand` 가 쓴다 | 직접 쓰지 않음 |
| `personal.handoff.enabled` | `true` | `progress.md` 인계 훅 | `false` |
| `personal.handoff.file` | `"progress.md"` | 인계 파일 경로(저장소 기준) | `"docs/progress.md"` |
| `personal.handoff.throttle_min` | `20` | 같은 세션을 다시 막지 않는 시간(분) | `30` |
| `personal.handoff.max_lines` | `300` | 인계 파일 기준 줄 수(20 이상) | `200` |
| `personal.handoff.archive_dir` | `"docs/progress-archive"` | 아카이브 폴더 | `"docs/history"` |
| `personal.checkpoint.enabled` | `true` | 한도·서브에이전트 종료·대화 압축 때 `wip(wb)` 커밋 | `false` |
| `personal.paths.scratch_root` | `"~/.wb-scratch/{project}"` | 커밋하지 않는 스크래치 폴더. `{project}` 는 저장소 폴더 이름 | `"~/scratch/{project}"` |
| `personal.token_guard.enabled` | `true` | 토큰 가드 | `false` |
| `personal.token_guard.stages` | `[90,95,99]` | 단계별 비율(%) | `[85,95,99]` |
| `personal.token_guard.budget` | `0` | 예산(가중 토큰). 0 이면 가드가 동작하지 않는다. `wb-token calibrate` 가 쓴다 | `250000000` |
| `personal.token_guard.window_hours` | `5` | 사용량을 합치는 최근 시간 | `5` |
| `personal.terse` | `false` | 스위치가 없는 모든 저장소에서 간결 모드 | `true` |
| `personal.design_plugin` | `""` | 큰 설계 요청에 안내할 별도 플러그인 이름 | `"my-design-plugin"` |

### 4.4 프로젝트(`project`)

저장소의 `.wb/config.json` 최상위에 둔다. 표의 키 이름에서 `project.` 를 뺀 것이 파일 안의 경로다.

**기본 정보와 git**

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.version` | `1` | 파일 형식 판 | `1` |
| `project.project_kind` | `"other"` | `web-ui` · `service` · `library` · `other`. `web-ui` 면 화면 파일 변경을 화면 변경으로 본다 | `"web-ui"` |
| `project.git.protected_branches` | `["main","master","release/*"]` | 보호 브랜치. 보호 목록 규칙 | `["develop"]` |
| `project.git.integration_branch_pattern` | `"wb/*/int"` | 통합 브랜치 이름 규칙 | `"team/*/int"` |
| `project.git.lane_branch_pattern` | `"wb/*/l*"` | 레인 브랜치 이름 규칙 | `"team/*/l*"` |
| `project.git.worktree_root` | `"{repo}/../wt-{task}"` | 레인 워크트리 경로. `{repo}` 는 주 체크아웃, `{task}` 는 레인 이름 | `"{repo}/../lanes/{task}"` |
| `project.git.main_checkout` | `"auto"` | 주 체크아웃 위치(예약) | 기본값 유지 |
| `project.git.feature_push` | `"ask"` | 메인 세션의 기능 브랜치 push. `ask` · `allow` · `deny` | `"allow"` |
| `project.git.gate_stamp` | `"wb-gate-pass"` | 게이트 통과 표식 파일 이름(`<git 공용 폴더>/wb/<이름>.json`) | 기본값 유지 |
| `project.git.owner_grant_ttl_min` | `15` | 소유자 허가 유효 시간(분) | `30` |

**저장 위치(`project.paths`)**

자리 표시는 `{lane}`, `{date}`, `{slug}`, `{name}`, `{HHMM}`, `{stamp}`, `{scratch_root}` 이다.

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.paths.briefs` | `".wb/briefs/{lane}.md"` | 지시서 | `".wb/briefs/{lane}.md"` |
| `project.paths.lane_reports` | `"{scratch_root}/reports/{lane}.md"` | 레인 보고 파일(커밋 안 함) | 기본값 유지 |
| `project.paths.reports_final` | `"docs/reports/{date}/{slug}.md"` | 최종 보고 원문(커밋) | `"docs/reports/{slug}.md"` |
| `project.paths.artifacts_temp` | `"{scratch_root}/art/{slug}/"` | 일회성 캡처와 보고 HTML | 기본값 유지 |
| `project.paths.artifacts_keep` | `"docs/reports/artifacts/{slug}/"` | 다시 볼 캡처(커밋) | `"docs/img/{slug}/"` |
| `project.paths.artifacts_keep_webp` | `{"over_kb":300,"quality":80}` | 이 크기(KB)를 넘는 PNG 를 이 품질의 WebP 로 바꿈 | `{"over_kb":500,"quality":85}` |
| `project.paths.decisions` | `"docs/decisions/{date}-{slug}.md"` | 결정 문서(커밋) | 기본값 유지 |
| `project.paths.test_results` | `"docs/test-results/{date}/{name}-{HHMM}.xlsx"` | 시험 결과 엑셀(커밋). 같은 이름의 `.json` 이 함께 생긴다 | 기본값 유지 |
| `project.paths.test_runs_raw` | `"test-results/runs/{name}-{stamp}/"` | 원본 로그(커밋 안 함) | 기본값 유지 |
| `project.paths.metrics` | `".wb/metrics/"` | codegraph 응답 기록 | 기본값 유지 |
| `project.paths.e2e_ledger` | `"docs/e2e/"` | 시험 케이스 원장과 결함 대장 | `"tests/ledger/"` |

**검증과 문서**

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.gate.command` | `""` | 합치기 전 전체 검증 명령. 값이 있으면 보호 브랜치 병합·push 에 게이트 통과 표식이 필요하다 | `"npm test"` |
| `project.gate.verify_all` | `""` | 예약 | 비워 둠 |
| `project.gate.append_checks` | `[]` | 예약 | 비워 둠 |
| `project.glossary.terms_dict` | `"docs/glossary/terms.yaml"` | 용어 사전. 있으면 검수 9번 항목이 동작한다 | 기본값 유지 |
| `project.glossary.terms_scan` | `"docs/glossary/config.json"` | 예약 | 기본값 유지 |
| `project.glossary.copy_globs` | `[]` | 예약 | 비워 둠 |
| `project.style.map` | `[{"glob":"docs/**/*.md","style":"report"}]` | 파일별 문체. 앞에서부터 처음 맞는 항목이 이긴다. 문체는 `haeyo` · `report` · `plain` | `[{"glob":"src/**/*.tsx","style":"haeyo"}]` |
| `project.mockup.ui_globs` | `[]` | 화면 파일 범위. 비어 있으면 시안 먼저 훅이 동작하지 않는다 | `["src/**/*.tsx"]` |
| `project.mockup.tokens_css` | `""` | 시안을 만들 때 쓸 디자인 토큰 CSS(스킬 참고) | `"src/styles/tokens.css"` |
| `project.mockup.decision_required` | `true` | 화면 구조 변경에 시안 결정을 요구할지 | `false` |
| `project.ui_stability.enabled` | `false` | 예약 | 기본값 유지 |
| `project.ui_stability.adapter` | `"uistab.adapter.ts"` | 예약 | 기본값 유지 |

**코드 색인, 실행, 레인**

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.codegraph.nudge` | `"warn"` | 식별자 grep 때 codegraph 안내. `warn` · `off` | `"off"` |
| `project.codegraph.auto_index` | `true` | 워크트리 생성·grep·색인 없음 응답 때 자동으로 색인 대기열에 넣을지 | `false` |
| `project.codegraph.index_on_worktree` | 없음 | `auto_index` 의 옛 이름. 한 판 동안 별칭으로 읽는다 | 쓰지 않음 |
| `project.slots.heavy` | `[]` | 무거운 실행으로 볼 정규식 추가 | `["^make all$"]` |
| `project.slots.browser` | `[]` | 브라우저 실행으로 볼 정규식 추가 | `["^npm run shots$"]` |
| `project.worktree.setup` | `""` | 새 레인 워크트리에서 슬롯 안에 실행할 설치 명령. `WB_LANE`, `WB_PORT_<이름>` 을 받는다 | `"npm ci"` |
| `project.worktree.hook` | `false` | Claude Code 의 워크트리 생성도 wb 방식으로 할지 | `true` |
| `project.protected_paths` | `[]` | 에이전트가 쓰면 안 되는 경로(glob). 보호 목록 규칙 | `["db/prod/**"]` |
| `project.dispatch.brief` | `"deny"` | 지시서 검사. `deny` 는 차단, `warn` 은 안내만, `off` 는 검사 안 함 | `"warn"` |
| `project.dispatch.exempt_agents` | `["fork","claude-code-guide","statusline-setup"]` | 지시서 검사를 건너뛸 에이전트 종류 | `["fork"]` |
| `project.waves.stale_min` | `20` | 활동이 이 시간(분) 넘게 없는 진행 레인을 멈춤으로 봄 | `40` |
| `project.numbers` | `{}` | 번호 예약 계열. 계열마다 `dir`, `pattern`, `width`, `start` | 아래 예 |

```json
"numbers": { "migration": { "dir": "db/migrations", "pattern": "^(\\d+)_", "width": 3, "start": 1 } }
```

`wb-number reserve migration --lane l3` 은 폴더의 파일과 살아 있는 예약보다 큰 번호를 돌려준다.

**검수·취합·설명**

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.review.guards` | `[]` | 검수 3번 항목에서 돌릴 명령. 항목은 `name`, `command` | `[{"name":"lint","command":"npm run lint"}]` |
| `project.review.report_fields` | `["head","tests","remaining"]` | 레인 보고 파일에 있어야 할 항목 | `["head","tests"]` |
| `project.integrate.rules` | 아래 설명 | 충돌 분류 규칙. 항목은 `glob`, `kind`(`ledger` · `union` · `generated` · `code`). 앞에서부터 처음 맞는 규칙 | `[{"glob":"**/*.snap","kind":"generated"}]` |
| `project.integrate.regenerate` | `[]` | 생성물 충돌 뒤 다시 만들 명령. 항목은 `name`, `command`, `glob` | `[{"name":"lock","command":"npm install","glob":"**/package-lock.json"}]` |
| `project.integrate.guards` | `[]` | 병합한 작업 트리에서 돌릴 명령. 하나라도 실패하면 병합을 되돌린다 | `[{"name":"typecheck","command":"npm run typecheck"}]` |
| `project.explain.links` | `[]` | `wb-explain links` 가 보여 줄 교육 자료. 항목은 `title`, `href` | `[{"title":"팀 안내서","href":"docs/guide.md"}]` |

`project.integrate.rules` 의 기본값은 다음 일곱 규칙이다. `**/*.cases.json`, `**/defect-register.json` 은 원장(`ledger`), `**/hooks/hooks.json` 은 등록 파일(`union`), `**/*.xlsx`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/yarn.lock` 은 생성물(`generated`)이다. 맞는 규칙이 없는 파일은 코드로 본다.

## 5. 설정 예

**프로젝트(`.wb/config.json`)**

```json
{
  "version": 1,
  "project_kind": "web-ui",
  "gate": { "command": "npm test", "verify_all": "", "append_checks": [] },
  "git": { "protected_branches": ["develop"] },
  "style": { "map": [
    { "glob": "src/**/*.{tsx,vue}", "style": "haeyo" },
    { "glob": "docs/**/*.md", "style": "report" }
  ] },
  "worktree": { "setup": "npm ci" },
  "slots": { "heavy": ["^make all$"] },
  "machine": { "lanes": { "max": 2 } }
}
```

**머신(`~/.wb/machine.json`)**

```json
{
  "version": 1,
  "lanes": { "max": 6 },
  "load": { "max": 16 },
  "slots": { "guard": "deny" },
  "ports": {
    "protected": [
      { "name": "my-api", "port": 8080, "project": "*", "note": "늘 켜 두는 개발 서버" }
    ]
  }
}
```

이 두 파일이 함께 있으면 `machine.lanes.max` 는 상한 규칙에 따라 2 가 된다. 머신 파일의 6 보다 프로젝트의 2 가 작기 때문이다.

**개인(`~/.wb/personal.json`)**

```json
{
  "version": 1,
  "language": "ko",
  "report": { "chat_detail": "detailed", "viewer": "remote" },
  "auto_retry": { "enabled": true, "permission_mode": "default" },
  "paths": { "scratch_root": "~/.wb-scratch/{project}" }
}
```

## 6. 환경 변수

| 변수 | 뜻 |
|---|---|
| `WB_HOME` | 개인·머신 설정 폴더(기본 `~/.wb`) |
| `WB_PROJECT_DIR` | 프로젝트 루트를 직접 지정 |
| `WB_CODEGRAPH` | `off` 면 codegraph 기능 전체를 끈다. 경로를 주면 그 실행 파일을 쓴다 |
| `WB_SLOT_HELD` | `wb-slot` 이 실행하는 명령에 넣어 주는 값. 직접 설정하지 않는다 |
| `WB_LANE`, `WB_PORT_<이름>` | `project.worktree.setup` 명령에 넣어 주는 레인 이름과 포트 |
