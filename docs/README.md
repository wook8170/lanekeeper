# Lanekeeper 사용 설명서 · Lanekeeper user manual

Lanekeeper(에이전트 작업대)는 Claude Code 에서 여러 서브에이전트 레인을 함께 돌릴 때 필요한 규칙을 설정 파일과 훅으로 관리하는 플러그인이다. 이 설명서는 플러그인을 처음 쓰는 개발자와 개발팀 관리자를 위해 썼다.

Lanekeeper (Agent Workbench) is a Claude Code plugin that keeps the rules for running several subagent lanes together in settings files and hooks. This manual is for developers and team leads who use the plugin for the first time.

## 한국어

| 문서 | 내용 |
|---|---|
| [1. 시작하기](ko/01-getting-started.md) | 설치, `/lanekeeper:init`, 처음 30분 따라 하기(브리프 → 시안 → 레인 → 검수 → 취합 → 보고) |
| [2. 기능 안내](ko/02-features.md) | 기능별 사용법과 스킬 28개 |
| [3. 설정](ko/03-configuration.md) | 설정 층, 합치는 규칙, 키 전체 참조 |
| [4. 규칙 안내](ko/04-rules.md) | 규칙 53개: 무엇을 막는지, 왜, 걸렸을 때 고치는 법 |
| [5. 문제 해결](ko/05-troubleshooting.md) | 메시지별 해결, 자주 묻는 질문, 알려진 제한 |

## English

| Page | Contents |
|---|---|
| [1. Getting started](en/01-getting-started.md) | Installation, `/lanekeeper:init`, the first 30 minutes (brief → mockup → lane → review → integrate → report) |
| [2. Features](en/02-features.md) | How to use each feature, and the 28 skills |
| [3. Configuration](en/03-configuration.md) | Settings layers, merge rules, reference of every key |
| [4. Rules](en/04-rules.md) | The 53 rules: what each blocks, why, and how to fix the work |
| [5. Troubleshooting](en/05-troubleshooting.md) | Fixes by message, frequently asked questions, known limitations |

## 문서 관리 · Maintaining these pages

`ko/04-rules.md` 와 `en/04-rules.md` 는 `rules/catalog.json` 에서 `lanekeeper-rules manual --write` 로 만든다. 나머지 문서는 직접 고친다. `npm test` 의 `tests/docs.test.mjs` 가 설명서의 스킬 이름, 명령, 설정 키와 기본값, 규칙 수를 코드와 대조한다.

`ko/04-rules.md` and `en/04-rules.md` are generated from `rules/catalog.json` with `lanekeeper-rules manual --write`. The other pages are edited by hand. `tests/docs.test.mjs` in `npm test` checks the skill names, commands, settings keys with their defaults and the rule count in these pages against the code.
