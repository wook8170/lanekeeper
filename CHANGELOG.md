# Changelog

이 저장소는 semver 를 따른다. 0.x 동안에는 minor 버전에서도 설정 형식이 바뀔 수 있다.

## [Unreleased]

### Added
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
- 규칙 카탈로그 문구를 처음 쓰는 관리자가 읽기 쉬운 업무 문체로 다시 썼다(규칙·이유·복구, ko/en). 규칙마다 짧은 이름(`title`)을 더했고, 생성 문서의 제목은 `### <이름> (\`<id>\`)` 형식이다. 머리말에 레인·웨이브·취합 담당·소유자·게이트의 뜻을 적었다. `wb-rules list` 는 이름을 보여 준다
- 큰 설계 트랙 플러그인 이름을 코드에서 빼고 개인 설정 `design_plugin`(기본 빈 값)으로 옮겼다. 비어 있으면 `wb-work plan` 이 설정 방법을 안내한다
- 쓰이지 않던 기본 설정 `paths.progress`(실제 경로는 `personal.handoff.file`)와 `paths.waves`(원장은 `<git 공용 폴더>/wb/`)를 지웠다
- codegraph 설치 안내 예시를 npm 패키지 명령(`npm install -g @colbymchenry/codegraph`)으로 바꿨다
- 시험과 주석의 포트 예시를 일반 값(8080·3000)으로 바꿨다
- 핸드오프 파일 방식 변경: `progress.md` 는 지금 유효한 상태만 담고(기본 300줄 이하) 매 웨이브 통째로 다시 쓴다. 끝난 내용은 `docs/progress-archive/progress-<YYYY-MM>.md` 끝에 `## <YYYY-MM-DD HH:MM> — <요지>` 절로 덧붙인다. 「최신 절을 맨 위에 추가하고 이전 절 유지」 안내를 없앴다
- 세션 시작 훅·`wb-waves resume`·`/wb:pickup`·`/wb:resume` 은 `progress.md` 전체를 보여 주고 아카이브 검색 방법(`grep -n '<키워드>' docs/progress-archive/*.md`)을 안내한다. 기준 줄 수를 넘은 누적형 파일만 최신 절을 보여 준다
- 종료 가드 문구가 아카이브 덧붙임 → 통째로 다시 쓰기 → 두 파일 함께 커밋 순서를 요구하고, 파일이 기준을 넘으면 옮기는 방법을 덧붙인다
- 규칙 카탈로그 `progress-handoff` 의 규칙·이유·복구 문구와 지키는 위치(`bin/wb-waves`, `personal.handoff`)를 갱신

### Security
- 검수 9항목의 화면 확인(`--serve-url`)이 이 머신 주소(`localhost`·`127.0.0.0/8`·`[::1]`)만 읽는다. 다른 주소는 `serving.not_local` 로 실패한다
- `wb-art --slug` 가 경로 구분자와 `..` 을 거부한다(아티팩트 폴더 밖 쓰기 방지)
- 되돌림 지시서와 `wb-check lane` 이 레인 이름을 검사한다(경로 순회 방지)
- 색인 복사에서 따옴표·제어 문자가 든 경로는 `sqlite3 .backup` 대신 파일 복사를 쓴다
- 자동 재개 로그(재개한 세션의 출력)를 본인만 읽을 수 있게 만든다(폴더 0700, 파일 0600)
