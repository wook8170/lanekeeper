# Changelog

이 저장소는 semver 를 따른다. 0.x 동안에는 minor 버전에서도 설정 형식이 바뀔 수 있다.

## [Unreleased]

### Added
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
