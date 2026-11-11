# 설정

Lanekeeper 의 설정은 파일 네 층으로 나뉜다. 팀이 함께 정할 값은 저장소에 커밋하는 프로젝트 설정에 두고, 머신 사양과 개인 선호는 커밋하지 않는 홈 폴더 파일에 둔다. 이 문서는 층별 파일, 값을 합치는 규칙, 키 전체의 기본값과 뜻을 정리했다.

## 1. 설정 층

| 층 | 파일 | git 추적 | 담는 것 |
|---|---|---|---|
| 기본값 | 플러그인 `defaults/config.json`, `machine.json`, `personal.json`, `routing.json` | 플러그인 저장소 | 모든 키의 기본값 |
| 프로젝트 | `<저장소>/.lanekeeper/config.json` | 커밋 | 프로젝트 종류, 브랜치 규칙, 저장 위치, 검증 명령, 문체 지도 |
| 머신 | `~/.lanekeeper/machine.json` | 안 함 | 레인 수, 실행 슬롯, 부하 문턱, 보호 포트, 레인 포트 대역 |
| 플러그인 설정 화면 | `/plugin configure lanekeeper@lanekeeper` | 안 함 | 메시지 언어, 보고 분량. 훅 실행 때만 읽힌다 |
| 개인 | `~/.lanekeeper/routing.json`, `~/.lanekeeper/personal.json` | 안 함 | 모델 라우팅과 금지 모델, 언어, 보고 분량, 자동 재개, 인계, 토큰 가드 |

프로젝트 설정 파일의 최상위 키는 `project` 영역이다. 같은 파일에 `machine`, `personal`, `routing` 절을 두면 그 영역의 값으로 읽는다. 예를 들어 프로젝트가 레인 수를 2 로 낮추려면 `.lanekeeper/config.json` 에 `"machine": { "lanes": { "max": 2 } }` 를 둔다.

`~/.lanekeeper` 대신 다른 폴더를 쓰려면 환경 변수 `LANEKEEPER_HOME` 을 지정한다. 예시 파일은 플러그인의 `examples/` 에 있다.

## 2. 값을 합치는 규칙

| 키 종류 | 규칙 | 해당 키 |
|---|---|---|
| 일반 값 | 높은 층이 덮어쓴다. 개인 > 플러그인 설정 화면 > 머신 > 프로젝트 > 기본값 | 아래 두 줄을 뺀 모든 키 |
| 보호 목록 | 모든 층의 합집합. 어느 층도 다른 층이 넣은 항목을 지울 수 없다 | `routing.denied`, `machine.ports.protected`, `project.git.protected_branches`, `project.protected_paths`, `project.protected_data.paths`, `project.protected_data.ports`, `project.protected_data.containers` |
| 상한 | 기본값을 뺀 층 중 가장 작은 값. 다른 층에 값이 없을 때만 기본값을 쓴다 | `machine.lanes.max`, `machine.slots.heavy.count`, `machine.slots.browser.count`, `machine.load.max` |

상한 규칙에서 기본값을 빼는 이유는 개인 머신 파일이 기본값(레인 3개)보다 큰 값을 쓸 수 있게 하기 위해서다. 프로젝트는 그 값을 더 낮출 수만 있다.

## 3. 설정 확인 명령

```
lanekeeper-config get <키>          합친 값
lanekeeper-config explain <키>      합치는 규칙, 적용된 층, 값을 둔 모든 층
lanekeeper-config validate          파일별 형식 검사. 오류가 있으면 종료 코드 1
lanekeeper-config dump              합친 설정 전체
lanekeeper-config doctor            점검과 주요 값의 출처
```

모르는 키는 무시하고 경고로만 알린다. 형식이 틀린 값은 오류다. 설정에 오류가 있는 동안 안전 훅은 git 반영·프로세스 종료·삭제·브라우저 실행을 막는다.

```
lanekeeper-config validate
설정에 오류가 없습니다.
```

## 4. 키 참조

표의 기본값은 JSON 으로 적었다. 「예약」 표시가 있는 키는 형식만 검사한다. 이 판의 명령과 훅은 이 키를 읽지 않는다. 「스킬 참고」 표시가 있는 키는 명령이 직접 읽지 않고 스킬 안내에서 Claude 가 참고한다.

### 4.1 모델 라우팅(`routing`)

개인 파일 `~/.lanekeeper/routing.json` 에 둔다.

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `routing.version` | `1` | 파일 형식 판 | `1` |
| `routing.models` | 아래 설명 | 모델 이름별 Agent 도구 값(`agent_param`)과 등급(`rank`). 등급이 클수록 높다 | `{"opus":{"agent_param":"opus","rank":3}}` |
| `routing.denied` | `[]` | 쓰지 않을 모델. 보호 목록 규칙으로 합친다 | `["haiku"]` |
| `routing.denied_note` | `{}` | 금지 이유 메모(스킬 참고) | `{"haiku":"개인 결정"}` |
| `routing.tasks` | 아래 설명 | 작업 종류별 `label`, `chain`(대체 순서), `floor`(최소 등급), `on_floor`(`wait-notify`), `differ_from`(`implementer`), `weight`(`light` · `heavy`, 없으면 `heavy`) | `{"review":{"chain":["opus"]}}` |
| `routing.limits_state` | `"${CLAUDE_PLUGIN_DATA}/limits.json"` | 사용 한도에 걸린 모델 기록 파일 | 기본값 유지 |

`routing.models` 의 기본값은 opus(등급 3), sonnet(2), haiku(1)이다. 이 세 모델은 모든 Claude Code 계정에서 쓸 수 있다. `routing.tasks` 의 기본값 11종은 [기능 안내](02-features.md) 2절의 표와 같다. 작업 종류 하나만 바꿀 때는 그 항목의 바꿀 키만 적는다.

모델을 하나 더 쓰려면 `routing.models` 에 그 모델을 넣고, 먼저 써 볼 작업 종류의 사슬 맨 앞에 둔다. 사슬 배열은 기본값을 통째로 바꾸므로 순서 전체를 적는다. 새 모델이 금지되거나 한도에 걸리면 사슬의 다음 모델을 쓴다. 아래 예는 설계와 검수에 opus 보다 높은 등급의 모델을 먼저 쓰고, haiku 는 쓰지 않는 설정이다.

```json
{
  "version": 1,
  "models": { "fable": { "agent_param": "fable", "rank": 4 } },
  "tasks": {
    "design": { "chain": ["fable", "opus"] },
    "review": { "chain": ["fable", "opus"] }
  },
  "denied": ["haiku"],
  "denied_note": { "haiku": "개인 결정. 지우면 다시 쓴다" }
}
```

### 4.2 머신(`machine`)

개인 파일 `~/.lanekeeper/machine.json` 에 둔다. 포트 숫자는 이 파일에만 둔다.

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `machine.version` | `1` | 파일 형식 판 | `1` |
| `machine.lanes.max` | `3` | 동시에 살아 있을 수 있는 레인 수. 상한 규칙 | `6` |
| `machine.load.max` | `"auto"` | 이 1분 부하 이상이면 슬롯 실행을 기다린다. `auto` 는 논리 코어 수 × 2. 상한 규칙 | `16` |
| `machine.load.auto_rule` | `"logical_cores * 2"` | `auto` 계산식 설명(예약) | 기본값 유지 |
| `machine.load.sample` | `"1min"` | 비교할 부하 평균. `1min` · `5min` · `15min` | `"5min"` |
| `machine.load.tiers.light_only` | `"auto"` | 이 1분 부하 이상이면 무거운 실행이 있는 작업 종류(`weight` 가 `light` 가 아닌 종류)의 새 레인을 막는다. 설계·검수·적대 검증·문서·시안처럼 가벼운 종류는 띄울 수 있다. `auto` 는 논리 코어 수 × 1.5(반올림). 새 레인 보류 문턱보다 크면 그 값으로 내린다 | `15` |
| `machine.load.tiers.hold_new_lanes` | `"auto"` | 이 1분 부하 이상이면 새 레인(Agent 디스패치)을 막는다. 이미 있는 레인으로 보내는 디스패치는 막지 않는다. `auto` 는 논리 코어 수 × 2 | `20` |
| `machine.load.tiers.stop_heavy` | `"auto"` | 이 1분 부하 이상이면 검수 레인의 무거운 실행을 바로 거부한다. 이미 잡힌 슬롯은 그대로 둔다. `auto` 는 논리 코어 수 × 2.8(반올림). 새 레인 보류 문턱보다 작으면 그 값으로 올린다 | `28` |
| `machine.load.check_every_min` | `30` | 프롬프트를 보낼 때 부하를 보는 간격(분). 문턱을 넘었을 때만 한 줄을 알린다. `0` 은 끔 | `0` |
| `machine.slots.heavy.count` | `2` | 무거운 실행 슬롯 수. 상한 규칙 | `3` |
| `machine.slots.heavy.patterns` | `["full-test","e2e","typecheck-all","build","install","codegraph-index"]` | 무거운 실행으로 볼 패턴 묶음 이름(`defaults/heavy-patterns.json`) | `["full-test","e2e"]` |
| `machine.slots.browser.count` | `2` | 브라우저 슬롯 수. 상한 규칙 | `1` |
| `machine.slots.browser.patterns` | `["chrome-headless","playwright","cdp"]` | 브라우저 실행으로 볼 패턴 묶음 이름 | `["playwright"]` |
| `machine.slots.lease_dir` | `"~/.lanekeeper/run/slots"` | 슬롯 임대 파일 폴더 | 기본값 유지 |
| `machine.slots.stale_after_min` | `90` | 이 시간(분) 동안 갱신이 없는 임대를 회수 | `120` |
| `machine.slots.guard` | `"warn"` | 슬롯 없이 실행한 무거운 명령 처리. `warn` 은 안내, `deny` 는 차단 | `"deny"` |
| `machine.ports.protected` | `[]` | 종료하면 안 되는 포트 목록. 항목은 `name`, `port`, `project`, `note`. 보호 목록 규칙 | `[{"name":"my-api","port":8080,"project":"*"}]` |
| `machine.ports.lane_range.base` | `41000` | 레인 포트 대역 시작 번호 | `42000` |
| `machine.ports.lane_range.step` | `20` | 레인 하나가 차지하는 포트 칸 수 | `10` |
| `machine.ports.lane_range.per_lane` | `["web","web2","api","db","aux"]` | 레인마다 빌려 주는 포트 이름 | `["web","api"]` |
| `machine.ports.lane_range.max_lanes` | `9` | 대역 안의 최대 레인 수 | `6` |
| `machine.ports.leases` | `"{git_common_dir}/lanekeeper/ports.json"` | 포트 임대 대장 위치 | 기본값 유지 |
| `machine.servers` | `[]` | 취합 뒤 다시 띄울 서버 목록. 항목은 `name`, `port_ref`, `restart`, `verify_url_path`(스킬 참고) | `[{"name":"my-web","port_ref":"my-api","restart":"manual"}]` |

### 4.3 개인(`personal`)

개인 파일 `~/.lanekeeper/personal.json` 에 둔다. `language` 와 `report.chat_detail` 은 플러그인 설정 화면에서도 고를 수 있다. 두 곳에 모두 값이 있으면 이 파일의 값을 쓴다.

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `personal.version` | `1` | 파일 형식 판 | `1` |
| `personal.language` | `"auto"` | 메시지 언어. `auto` 는 시스템 로캘을 따른다 | `"ko"` |
| `personal.report.chat_detail` | `"summary"` | 채팅 보고 분량. `summary` 는 요약과 아티팩트 링크, `detailed` 는 표·근거·수치까지 채팅에 싣는다 | `"detailed"` |
| `personal.report.viewer` | `"local"` | 보고를 보는 곳. `remote` 면 원격 기기에서 열 수 있는 형태로 만든다(스킬 참고) | `"remote"` |
| `personal.report.artifact_fallback` | `"html-file"` | 아티팩트 도구가 없을 때 대신 쓸 방식. `html-file` · `none` | `"none"` |
| `personal.report.artifact_check` | `true` | 보고 단계가 아티팩트 없이 끝나면 한 번 막을지 | `false` |
| `personal.auto_retry.enabled` | `false` | 사용 한도 뒤 자동 재개. 사용자가 켜기 전까지 꺼져 있다(`/lanekeeper:auto-retry on`) | `true` |
| `personal.auto_retry.permission_mode` | `"default"` | 재개 세션의 권한 모드. `default` · `acceptEdits` · `plan` · `bypassPermissions` | `"acceptEdits"` |
| `personal.auto_retry.bypass_ack` | `false` | `bypassPermissions` 위험 확인 기록. `/lanekeeper:approve retry-bypass` 가 쓰고, `~/.lanekeeper/personal.json` 에 있는 값만 읽는다 | 직접 쓰지 않음 |
| `personal.handoff.enabled` | `true` | `progress.md` 인계 훅 | `false` |
| `personal.handoff.inject` | `"summary"` | 세션 시작에 넣는 `progress.md` 분량. `summary` 는 첫 절(최대 40줄·2,500자)만 넣고 전체는 파일을 읽게 한다. `full` 은 현재 상태 전체 | `"full"` |
| `personal.handoff.file` | `"progress.md"` | 인계 파일 경로(저장소 기준) | `"docs/progress.md"` |
| `personal.handoff.throttle_min` | `20` | 같은 세션을 다시 막지 않는 시간(분) | `30` |
| `personal.handoff.max_lines` | `300` | 인계 파일 기준 줄 수(20 이상) | `200` |
| `personal.handoff.archive_dir` | `"docs/progress-archive"` | 아카이브 폴더 | `"docs/history"` |
| `personal.checkpoint.enabled` | `true` | 한도·서브에이전트 종료·대화 압축 때 `wip(lanekeeper)` 커밋 | `false` |
| `personal.paths.scratch_root` | `"~/.lanekeeper-scratch/{project}"` | 커밋하지 않는 스크래치 폴더. `{project}` 는 저장소 폴더 이름 | `"~/scratch/{project}"` |
| `personal.token_guard.enabled` | `true` | 토큰 가드 | `false` |
| `personal.token_guard.stages` | `[90,95,99]` | 단계별 비율(%) | `[85,95,99]` |
| `personal.token_guard.budget` | `0` | 공식 사용량이 없을 때 쓰는 대체 예산(가중 토큰). 0 이면 계정의 보정 계수에서 100% 를 환산하고, 그것도 없으면 가드가 동작하지 않는다. `lanekeeper-token calibrate <n>` 이 쓴다 | `250000000` |
| `personal.token_guard.window_hours` | `5` | 대체 예산으로 판정할 때 사용량을 합치는 최근 시간 | `5` |
| `personal.token_guard.fresh_min` | `10` | 공식 사용량을 그대로 쓰는 시간(분). 이보다 오래되면 그 뒤 로컬 사용 추정을 더한다 | `5` |
| `personal.token_guard.source` | `"auto"` | 사용량 출처. `auto` 는 공식 값과 추정, `official` 은 공식 값만, `local` 은 대체 예산 방식만 쓴다. 공식 값에 5시간 항목이 없으면(`five_hour: null`) 7일 비율만 쓴다 | `"official"` |
| `personal.terse` | `false` | 스위치가 없는 모든 저장소에서 간결 모드 | `true` |
| `personal.global_hooks` | `"defer"` | Claude Code 설정(`CLAUDE_CONFIG_DIR/settings.json`, `~/.claude/settings.json`)에 같은 종류의 훅(핸드오프·토큰 가드·자동 재개·간결 모드)이 이미 있으면 Lanekeeper 의 그 훅을 끈다. `ignore` 면 그대로 켠다 | `"ignore"` |
| `personal.search.rg_hint` | `true` | `grep -r` 류 재귀 검색에 `rg` 안내(세션당 한 번, 막지 않음) | `false` |
| `personal.session_rules.language` | `true` | `personal.language` 가 `ko`·`en` 일 때 세션 시작에 출력 언어 규칙을 넣는다 | `false` |
| `personal.session_rules.remote` | `true` | `personal.report.viewer` 가 `remote` 일 때 세션 시작에 원격 사용자 규칙(아티팩트·base64 이미지·2배율 캡처)을 넣는다 | `false` |
| `personal.session_rules.conduct` | `true` | 세션 시작에 보고 정확성·소통·수정 원칙을 넣는다 | `false` |
| `personal.design_plugin` | `""` | 큰 설계 요청에 안내할 별도 플러그인 이름 | `"my-design-plugin"` |

### 4.4 프로젝트(`project`)

저장소의 `.lanekeeper/config.json` 최상위에 둔다. 표의 키 이름에서 `project.` 를 뺀 것이 파일 안의 경로다.

**기본 정보와 git**

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.version` | `1` | 파일 형식 판 | `1` |
| `project.project_kind` | `"other"` | `web-ui` · `service` · `library` · `other`. `web-ui` 면 화면 파일 변경을 화면 변경으로 본다 | `"web-ui"` |
| `project.git.protected_branches` | `["main","master","release/*"]` | 보호 브랜치. 보호 목록 규칙 | `["develop"]` |
| `project.git.integration_branch_pattern` | `"lanekeeper/*/int"` | 통합 브랜치 이름 규칙 | `"team/*/int"` |
| `project.git.lane_branch_pattern` | `"lanekeeper/*/l*"` | 레인 브랜치 이름 규칙 | `"team/*/l*"` |
| `project.git.worktree_root` | `"{repo}/../wt-{task}"` | 레인 워크트리 경로. `{repo}` 는 주 체크아웃, `{task}` 는 레인 이름 | `"{repo}/../lanes/{task}"` |
| `project.git.main_checkout` | `"auto"` | 주 체크아웃 위치(예약) | 기본값 유지 |
| `project.git.feature_push` | `"ask"` | 메인 세션의 기능 브랜치 push. `ask` · `allow` · `deny` | `"allow"` |
| `project.git.gate_stamp` | `"lanekeeper-gate-pass"` | 게이트 통과 표식 파일 이름(`<git 공용 폴더>/lanekeeper/<이름>.json`) | 기본값 유지 |
| `project.git.owner_grant_ttl_min` | `15` | 소유자 허가 유효 시간(분) | `30` |

**저장 위치(`project.paths`)**

자리 표시는 `{lane}`, `{date}`, `{slug}`, `{name}`, `{HHMM}`, `{stamp}`, `{scratch_root}` 이다.

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.paths.briefs` | `".lanekeeper/briefs/{lane}.md"` | 지시서 | `".lanekeeper/briefs/{lane}.md"` |
| `project.paths.lane_reports` | `"{scratch_root}/reports/{lane}.md"` | 레인 보고 파일(커밋 안 함) | 기본값 유지 |
| `project.paths.reports_final` | `"docs/reports/{date}/{slug}.md"` | 최종 보고 원문(커밋) | `"docs/reports/{slug}.md"` |
| `project.paths.artifacts_temp` | `"{scratch_root}/art/{slug}/"` | 일회성 캡처와 보고 HTML | 기본값 유지 |
| `project.paths.artifacts_keep` | `"docs/reports/artifacts/{slug}/"` | 다시 볼 캡처(커밋) | `"docs/img/{slug}/"` |
| `project.paths.artifacts_keep_webp` | `{"over_kb":300,"quality":80}` | 이 크기(KB)를 넘는 PNG 를 이 품질의 WebP 로 바꿈 | `{"over_kb":500,"quality":85}` |
| `project.paths.decisions` | `"docs/decisions/{date}-{slug}.md"` | 결정 문서(커밋) | 기본값 유지 |
| `project.paths.test_results` | `"docs/test-results/{date}/{name}-{HHMM}.xlsx"` | 시험 결과 엑셀(커밋). 같은 이름의 `.json` 이 함께 생긴다 | 기본값 유지 |
| `project.paths.test_runs_raw` | `"test-results/runs/{name}-{stamp}/"` | 원본 로그(커밋 안 함) | 기본값 유지 |
| `project.paths.metrics` | `".lanekeeper/metrics/"` | codegraph 응답 기록 | 기본값 유지 |
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
| `project.style.map` | `[{"glob":"docs/**/*.md","style":"report"}]` | 파일별 문체. 앞에서부터 처음 맞는 항목을 적용한다. 문체는 `haeyo` · `report` · `plain` | `[{"glob":"src/**/*.tsx","style":"haeyo"}]` |
| `project.mockup.ui_globs` | `[]` | 화면 파일 범위. 비어 있으면 시안 먼저 훅이 동작하지 않는다 | `["src/**/*.tsx"]` |
| `project.mockup.tokens_css` | `""` | 시안을 만들 때 쓸 디자인 토큰 CSS(스킬 참고) | `"src/styles/tokens.css"` |
| `project.mockup.decision_required` | `true` | 화면 구조 변경에 시안 결정을 요구할지 | `false` |
| `project.ui_stability.enabled` | `false` | 예약 | 기본값 유지 |
| `project.ui_stability.adapter` | `"uistab.adapter.ts"` | 예약 | 기본값 유지 |

**품질 결과와 출하 검증 관문(`project.quality`)**

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.quality.results_root` | `"docs/test-results"` | 종류별 결과(`<버전>/<날짜>/<종류>-<HHMM>.json`·`.xlsx`), 색인, 버전 취합본을 두는 폴더(커밋) | 기본값 유지 |
| `project.quality.raw_root` | `"test-results/runs"` | 실행 로그 같은 원자료 폴더(커밋 안 함) | 기본값 유지 |
| `project.quality.version_file` | `"VERSION"` | 버전을 읽을 파일(첫 줄). 없으면 `package.json` 의 version | `"version.txt"` |
| `project.quality.suites` | `{}` | 종류 이름별 실행 설정. 항목은 아래 표 | 아래 설정 예 |
| `project.quality.ship.requires` | `[]` | 출하 검증 전에 통과해야 하는 종류. 비어 있으면 관문이 꺼진다 | `["unit","e2e","gate"]` |
| `project.quality.ship.advisory` | `["ux-adversarial"]` | 같은 방식으로 확인하지만 통과하지 않아도 막지 않고 경고만 하는 종류. `requires` 에도 있으면 막는다 | `[]` |
| `project.quality.ship.enforce` | `"deny"` | 관문 훅의 동작. `deny`(막음) · `warn`(알림만) · `off` | `"warn"` |
| `project.quality.ship.agents` | `["readiness-auditor"]` | 관문을 거쳐야 하는 서브에이전트 종류(`플러그인:이름` 의 이름 부분도 맞춤) | 기본값 유지 |
| `project.quality.ship.skills` | `["verifying-production-readiness"]` | 관문을 거쳐야 하는 스킬. 서브에이전트 지시문에 이 이름이 있어도 관문을 거친다 | 기본값 유지 |
| `project.release.gates` | `[]` | 출하 전에 통과할 관문 목록: `[{ "name", "command", "required" }]`. `name` 은 영문 소문자 · 숫자 · `.` · `_` · `-` 로 쓴다. `required` 를 적지 않으면 `true` 다. 출하 검증 시작 · 보호 브랜치 반영 · 릴리스 태그 push 전에 그 커밋에서 필수 관문을 모두 통과한 표식이 있어야 한다. 표식은 `lanekeeper-test-report gates-pass [--name <이름>]` 가 남긴다. 그 커밋에서 이미 통과한 관문은 다시 돌리지 않는다. `required: false` 인 관문은 경고만 한다. 관문이 하나도 없으면 출하 검증 때 「릴리스 관문 미설정」 경고만 낸다 | 릴리스 관문 설정 예 참고 |
| `project.release.security_check` | `""` | 옛 단일 설정. 값이 있으면 이 명령을 쓰는 필수 관문 `security` 로 읽는다(`gates` 에 `security` 가 있으면 그쪽이 우선) | `"pnpm security:release-check"` |
| `project.release.security_required` | `false` | 옛 단일 설정. `true` 면 명령이 비어 있어도 필수 관문 `security` 를 더한다. 그래서 명령을 적을 때까지 막는다 | `true` |
| `project.release.security_stamp` | `"lanekeeper-security-pass"` | 관문 `security` 의 통과 표식 파일 이름(`<git 공용 폴더>/lanekeeper/<이름>.json`). 다른 관문은 `lanekeeper-release-<이름>-pass.json` 을 쓴다 | 기본값 유지 |
| `project.release.tag_patterns` | `["v*"]` | 릴리스 태그로 보는 태그 이름. 이 태그를 push 하면 태그 커밋에서 필수 관문을 확인한다 | `["v*","studio-v*"]` |

`quality.suites` 의 각 항목:

| 항목 | 뜻 |
|---|---|
| `category` | `unit` · `integration` · `gate` · `e2e` · `uistab` · `usability` · `ux-adversarial` · `ship`. 품질 스킬이 이 범주로 스위트를 고른다. 없으면 종류 이름이 범주 이름일 때 그 범주, 아니면 `unit` |
| `command` | 실행할 셸 명령. `{file}` 은 결과 파일, `{dir}` 은 원자료 폴더, `{root}` 는 저장소 경로로 바뀐다. 없고 `steps` 도 없으면 스킬이 시험한 뒤 `lanekeeper-quality record` 로 기록하는 종류다 |
| `steps` | `[{ "name": "docs", "cmd": "…" }]`. 단계마다 따로 실행하고 단계 하나를 시험 하나로 센다 |
| `parser` | 결과 형식. `vitest` · `jest` · `playwright` · `pytest`(JUnit XML) · `vitest-log`(로그의 `Tests` 줄 합계) · `json`(`counts` 를 담은 파일) · `exit`(종료 코드만) · `steps`. 기본값은 `steps` 가 있으면 `steps`, 없으면 `exit` |
| `result` | 결과 파일 경로. 기본 `{dir}/result.json`(pytest 는 `result.xml`). 마지막 경로 조각에 `*` 를 쓰면 여러 파일을 합친다 |
| `slot` | `heavy`(기본) · `browser` · `heavy,browser` · `none` |
| `thresholds` | 임계 파일 목록. `"경로"` 또는 `{ "file": "경로", "rule": "max" }`. `max` 는 숫자가 커지면, `min` 은 작아지면 완화로 보고, 배열이 길어지면 완화다. 규칙이 없으면 내용이 바뀐 것만으로 약화다 |
| `stale_paths` | 이 경로(glob)가 바뀌었을 때만 결과를 낡았다고 본다. 없으면 결과 폴더 밖 변경 전부 |
| `timeout_min` | 이 시간(분)이 지나면 명령을 멈춘다. 0 은 제한 없음 |
| `env` | 명령에 더할 환경 변수. 값에 `{file}` · `{dir}` 을 쓸 수 있다 |
| `note` | 설명 |

**문서 현행화(`project.docs_sync`)**

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.docs_sync.base` | `"main"` | 비교 기준 브랜치. 변경은 이 기준과의 merge-base 부터 작업 트리까지다(미커밋·새 파일 포함) | `"develop"` |
| `project.docs_sync.release_tag` | `"v*"` | `--base release` 가 고르는 최근 태그의 패턴 | `"release-*"` |
| `project.docs_sync.quality_base` | `"release"` | 품질 종류 `docs` 가 비교할 기준. `release` 는 최근 릴리스 태그(없으면 `base`) | `"main"` |
| `project.docs_sync.screen_sources` | `[]` | 화면 코드 경로(glob). 이 파일의 변경에서 문구와 시험 ID 를 읽는다 | `["apps/web/src/screens/**"]` |
| `project.docs_sync.screen_exclude` | `[]` | 화면 코드에서 뺄 경로(문서를 담은 화면 등) | `["apps/web/src/screens/manual/**"]` |
| `project.docs_sync.ignore` | `["**/*.test.*","**/*.spec.*"]` | 모든 판정에서 뺄 경로 | 기본값 유지 |
| `project.docs_sync.text_pattern` | `""` | 문구로 볼 문자열의 정규식(유니코드). 비우면 낱말 두 개 이상 | `"\\p{Script=Hangul}"` |
| `project.docs_sync.min_phrase_length` | `4` | 문구 최소 글자 수 | `3` |
| `project.docs_sync.max_files_per_phrase` | `12` | 이보다 많은 문서에 나오는 문구는 너무 흔해 역색인에서 뺀다 | `20` |
| `project.docs_sync.targets` | `[]` | 현행화 대상 `[{ "id", "name", "kind", "paths" }]`. 대상 하나를 품질 결과의 시험 하나로 센다 | 예시 파일 |
| `project.docs_sync.rules` | `[]` | `[{ "when", "unless", "require", "review", "why" }]`. 바뀐 경로(`when`)에 따라 대상을 필수나 검토로 정한다 | 예시 파일 |
| `project.docs_sync.mirrors` | `[]` | `[{ "from", "to", "target" }]`. `from` 정규식에 맞는 파일만 바뀌면 `to` 파일이 필수 | 예시 파일 |
| `project.docs_sync.groups` | `[]` | `[{ "name", "target", "files" }]`. 일부만 바뀌면 나머지가 필수 | 예시 파일 |
| `project.docs_sync.reverse_index.targets` | `[]` | 사라진 문구 · 주변 문구를 찾을 대상 id | `["manual","help"]` |
| `project.docs_sync.reverse_index.exclude` | `[]` | 역색인에서 뺄 경로(생성물 등) | `["docs/generated/**"]` |
| `project.docs_sync.shots.scripts` | `[]` | 캡처 스크립트 `[{ "file", "call_pattern", "key_pattern", "key_scope", "entry_functions", "image", "ref", "command" }]` | 예시 파일 |
| `project.docs_sync.shots.command` | `""` | 재촬영 명령. `{keys}` 에 장면 키 목록 | `"SCENES={keys} node scripts/capture.mjs"` |
| `project.docs_sync.screen_registry` | `{}` | 화면 목록 파일 `{ "file", "list", "sources", "id", "title" }`. 바뀐 파일이 소스인 화면을 보여 준다 | `{"file":"e2e/screens.json","list":"screens"}` |
| `project.docs_sync.autofix` | `[]` | `[{ "name", "when", "command" }]`. `lanekeeper-docs apply` 가 해당하는 것만 실행한다 | 예시 파일 |
| `project.docs_sync.checks` | `[]` | `[{ "name", "when", "command" }]`. `lanekeeper-docs verify` 가 실행한다. `when` 이 비면 항상 실행한다 | 예시 파일 |
| `project.docs_sync.manual_items` | `[]` | `[{ "when", "text" }]`. 사람이 할 일로 지도 끝에 나온다 | 예시 파일 |
| `project.docs_sync.ack_file` | `".lanekeeper/docs-sync-acks.json"` | 일부러 고치지 않는 필수 항목의 확인 기록(`{ "acks": [ … ] }`) | 기본값 유지 |
| `project.docs_sync.style` | `""` | 수정 초안 끝에 붙는 문체 안내 | `"짧은 문장, 화면 문구는 그대로 인용"` |
| `project.docs_sync.fail_on` | `"required"` | 관문이 실패로 보는 수준. `required` · `review`(검토 항목도 실패) | `"review"` |

설정 예는 플러그인의 [examples/docs-sync-config.json](../../examples/docs-sync-config.json) 에 있다.

**코드 색인, 실행, 레인**

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.codegraph.nudge` | `"warn"` | 식별자 grep 때 codegraph 안내. `warn` · `off` | `"off"` |
| `project.codegraph.auto_index` | `true` | 워크트리를 만들 때, grep 할 때, 「색인 없음」 응답을 받을 때 자동으로 색인 대기열에 넣을지 | `false` |
| `project.codegraph.index_on_worktree` | 없음 | `auto_index` 의 옛 이름. 한 판 동안 별칭으로 읽는다 | 쓰지 않음 |
| `project.slots.heavy` | `[]` | 무거운 실행으로 볼 정규식 추가 | `["^make all$"]` |
| `project.slots.browser` | `[]` | 브라우저 실행으로 볼 정규식 추가 | `["^npm run shots$"]` |
| `project.worktree.setup` | `""` | 새 레인 워크트리에서 슬롯 안에 실행할 설치 명령. `LANEKEEPER_LANE`, `LANEKEEPER_PORT_<이름>` 을 받는다 | `"npm ci"` |
| `project.worktree.hook` | `false` | Claude Code 의 워크트리 생성도 Lanekeeper 방식으로 할지 | `true` |
| `project.protected_paths` | `[]` | 에이전트가 쓰면 안 되는 경로(glob). 보호 목록 규칙 | `["db/prod/**"]` |
| `project.protected_data.paths` | `[]` | 시험이 쓰면 안 되는 DB 파일·폴더(glob, 프로젝트 기준 또는 절대 경로, `~` 가능). 보호 목록 규칙 | `["data/owner.db"]` |
| `project.protected_data.ports` | `[]` | 시험이 쓰면 안 되는 DB 서버 포트. psql·mysql 이 이 포트로 쓰기 SQL 을 보내면 레인은 막고 메인 세션은 확인을 받는다 | `[5432]` |
| `project.protected_data.containers` | `[]` | 시험이 쓰면 안 되는 컨테이너 이름. `docker exec` 쓰기 명령과 `docker cp` 를 판정한다 | `["owner-pg"]` |
| `project.lanes.commit` | `"allowed"` | 레인 커밋 정책. `allowed` 는 자기 브랜치 커밋 허용, `on-instruction` 은 지시서 표지에 `commit=allowed`(또는 「커밋 허용」 줄)가 있을 때만 허용하고 없으면 확인을 받는다. 체크포인트 커밋도 따른다 | `"on-instruction"` |
| `project.dispatch.brief` | `"deny"` | 지시서 검사. `deny` 는 차단, `warn` 은 안내만, `off` 는 검사 안 함 | `"warn"` |
| `project.dispatch.exempt_agents` | `["fork","claude-code-guide","statusline-setup"]` | 지시서 검사를 건너뛸 에이전트 종류 | `["fork"]` |
| `project.waves.stale_min` | `20` | 활동이 이 시간(분) 넘게 없는 진행 레인을 멈춤으로 봄 | `40` |
| `project.numbers` | `{}` | 번호 예약 계열. 계열마다 `dir`, `pattern`, `width`, `start` | 아래 예 |

```json
"numbers": { "migration": { "dir": "db/migrations", "pattern": "^(\\d+)_", "width": 3, "start": 1 } }
```

`lanekeeper-number reserve migration --lane l3` 은 폴더의 파일과 살아 있는 예약보다 큰 번호를 돌려준다.

**검수·취합·설명**

| 키 | 기본값 | 뜻 | 예 |
|---|---|---|---|
| `project.review.guards` | `[]` | 검수 3번 항목에서 돌릴 명령. 항목은 `name`, `command` | `[{"name":"lint","command":"npm run lint"}]` |
| `project.review.report_fields` | `["head","tests","remaining"]` | 레인 보고 파일에 있어야 할 항목 | `["head","tests"]` |
| `project.integrate.rules` | 아래 설명 | 충돌 분류 규칙. 항목은 `glob`, `kind`(`ledger` · `union` · `generated` · `code`). 앞에서부터 처음 맞는 규칙 | `[{"glob":"**/*.snap","kind":"generated"}]` |
| `project.integrate.regenerate` | `[]` | 생성물 충돌 뒤 다시 만들 명령. 항목은 `name`, `command`, `glob` | `[{"name":"lock","command":"npm install","glob":"**/package-lock.json"}]` |
| `project.integrate.guards` | `[]` | 병합한 작업 트리에서 돌릴 명령. 하나라도 실패하면 병합을 되돌린다 | `[{"name":"typecheck","command":"npm run typecheck"}]` |
| `project.explain.links` | `[]` | `lanekeeper-explain links` 가 보여 줄 교육 자료. 항목은 `title`, `href` | `[{"title":"팀 안내서","href":"docs/guide.md"}]` |

`project.integrate.rules` 의 기본값은 다음 일곱 규칙이다. `**/*.cases.json`, `**/defect-register.json` 은 원장(`ledger`), `**/hooks/hooks.json` 은 등록 파일(`union`), `**/*.xlsx`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/yarn.lock` 은 생성물(`generated`)이다. 맞는 규칙이 없는 파일은 코드로 본다.

## 5. 설정 예

**프로젝트(`.lanekeeper/config.json`)**

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

**품질 스위트(`.lanekeeper/config.json` 의 `quality`)**

pnpm 모노저장소에서 시험을 단위·시험용 DB·게이트·e2e·UI 안정성·사용성으로 나눈 예다. 전체는 플러그인의 [examples/quality-config.json](../../examples/quality-config.json) 에 있다.

```json
"quality": {
  "suites": {
    "unit": { "command": "pnpm -r --workspace-concurrency=1 test", "parser": "vitest-log" },
    "gate": { "category": "gate", "steps": [{ "name": "docs", "cmd": "pnpm docs:check" }, { "name": "lint", "cmd": "pnpm -r lint" }] },
    "e2e": { "category": "e2e", "command": "pnpm e2e --reporter=list,json", "parser": "playwright", "slot": "heavy,browser", "env": { "PLAYWRIGHT_JSON_OUTPUT_NAME": "{file}" } },
    "usability": { "category": "usability", "stale_paths": ["apps/**"] }
  },
  "ship": { "requires": ["unit", "gate", "e2e", "usability"] }
}
```

**릴리스 관문(`.lanekeeper/config.json` 의 `release`)**

보안 점검과 정적 분석을 출하 전 관문으로 두는 예다. SonarQube 관문은 서버에 그 프로젝트의 품질 게이트 상태를 묻고, Semgrep 관문은 발견 항목이 하나라도 있으면 실패한다. 프로젝트에 모든 점검을 함께 돌리는 명령이 있으면 관문 하나로 충분하다. P3vot 은 `security` = `pnpm security:release-check` 하나만 두고, 이 명령이 SonarQube · Semgrep 결과도 함께 판정한다([examples/p3vot-config.json](../../examples/p3vot-config.json)). 두 도구를 관문 하나로 묶을 수도 있다. 예를 들어 `"name": "static-analysis"` 에 두 명령을 `&&` 로 잇는다. 전체는 플러그인의 [examples/static-analysis-gates.json](../../examples/static-analysis-gates.json) 에 있다.

```json
"release": {
  "gates": [
    { "name": "security", "command": "pnpm security:release-check", "required": true },
    { "name": "sonarqube", "command": "curl -fsS -u \"$SONAR_TOKEN:\" \"$SONAR_HOST_URL/api/qualitygates/project_status?projectKey=<key>\" | jq -e '.projectStatus.status==\"OK\"'", "required": true },
    { "name": "semgrep", "command": "semgrep scan --config p/owasp-top-ten --error --metrics=off", "required": true }
  ],
  "tag_patterns": ["v*"]
}
```

`lanekeeper-test-report gates-pass` 는 지금 커밋에서 아직 통과하지 않은 관문을 모두 돌리고, 통과한 관문마다 표식을 남긴다. `--name semgrep` 은 그 관문만 돌린다. 관문이 막으면 안내 문구가 그 관문 이름과 이 명령을 알려 준다.

**머신(`~/.lanekeeper/machine.json`)**

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

**개인(`~/.lanekeeper/personal.json`)**

```json
{
  "version": 1,
  "language": "ko",
  "report": { "chat_detail": "detailed", "viewer": "remote" },
  "auto_retry": { "enabled": false, "permission_mode": "default" },
  "paths": { "scratch_root": "~/.lanekeeper-scratch/{project}" }
}
```

## 6. 환경 변수

| 변수 | 뜻 |
|---|---|
| `LANEKEEPER_HOME` | 개인·머신 설정 폴더(기본 `~/.lanekeeper`) |
| `LANEKEEPER_PROJECT_DIR` | 프로젝트 루트를 직접 지정 |
| `LANEKEEPER_CODEGRAPH` | `off` 면 codegraph 기능 전체를 끈다. 경로를 주면 그 실행 파일을 쓴다 |
| `LANEKEEPER_SLOT_HELD` | `lanekeeper-slot` 이 실행하는 명령에 넣어 주는 값. 직접 설정하지 않는다 |
| `LANEKEEPER_LOAD_FAKE` | 부하 평균 대신 쓸 숫자. 시험용이며 평소에는 설정하지 않는다 |
| `LANEKEEPER_LANE`, `LANEKEEPER_PORT_<이름>` | `project.worktree.setup` 명령에 넣어 주는 레인 이름과 포트 |
