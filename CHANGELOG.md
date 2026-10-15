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
- 개인 설정 키: `auto_retry.bypass_ack`, `handoff.*`, `checkpoint.enabled`, `token_guard.{budget, window_hours}`
- 실행 슬롯 `wb-slot`(무거운 실행·브라우저, 1분 부하 문턱, 임대 갱신·만료·죽은 소유자 회수)과 무거운 명령 패턴(`defaults/heavy-patterns.json`), 슬롯 없이 실행하면 알리거나 막는 PreToolUse 훅
- 포트 `wb-port`(이름으로 조회, 레인 대역 임대, 보호 포트·사용 중 포트 회피), 레인 워크트리 `wb-worktree`(통합 HEAD 기준 생성, 레인 대장 등록, `.worktreeinclude` 복사, 슬롯 안 설치 명령, 프로세스 확인 후 제거), WorktreeCreate·WorktreeRemove 훅, 정리 명령 `wb-reap`
