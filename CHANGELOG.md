# Changelog

이 저장소는 semver 를 따른다. 0.x 동안에는 minor 버전에서도 설정 형식이 바뀔 수 있다.

## [Unreleased]

### Added
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
