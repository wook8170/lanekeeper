# 코드 작성 기준

여러 레인이 코드를 나누어 쓰면 레인마다 파일 크기, 오류 처리, 의존 방향을 다르게 다루기 쉽다. 그래서 프로젝트가 정한 코드 작성 기준을 레인에게 알리고, 게이트와 검수와 경고 훅에서 다시 확인하는 기능을 둔다.

Lanekeeper 는 특정 프로젝트의 기준을 담지 않는다. 일반 원칙 여섯 가지는 `/lanekeeper:code-standards` 스킬에 있다. 프로젝트별 상한, 경로, 도우미 이름, 검사 명령은 프로젝트의 기준 문서에 두고, 설정 `project.code_standards` 가 그 문서를 가리킨다. 기본값은 모두 비어 있거나 꺼져 있으므로, 설정하지 않은 저장소에서는 아무 동작도 하지 않는다.

## 1. 일반 원칙

| 원칙 | 내용 |
|---|---|
| 상한과 래칫 | 새 파일과 새 함수에는 허용 폭이 없다. 처음부터 상한 안에 둔다. 검사의 기준선은 기능 작업에서 고치지 않는다 |
| 라우트에서 서비스로 | DB 호출은 직접 호출이든 다른 객체를 거친 호출이든 모두 서비스로 옮긴다. 트랜잭션은 서비스가 연다. 서비스는 라우트를 가져오지 않는다 |
| 오류 기록 도우미 | 빈 catch 와 `console` 을 쓰지 않는다. 무시해도 되는 오류는 기록 도우미로 남긴다. 검사를 피하는 모양(`.catch(도우미)`, `catch (e) { void e }`, `globalThis.console`)도 금지한다 |
| 순환과 다시 내보내기 금지 | 새 순환 의존을 만들지 않는다. 코드를 옮긴 뒤 옛 경로에 다시 내보내기 파일을 남기지 않는다 |
| 특성화 테스트 먼저 | 나누기 전에 현재 동작을 고정하는 테스트를 쓰고 따로 커밋한다. 옮긴 뒤 스냅샷과 골든 파일을 `-u` 로 다시 쓰지 않는다 |
| 동작 보존과 보호 경로 | 문구, 응답, 상태 코드, 테스트 손잡이, 순서, 로그 형식을 그대로 둔다. 보호 대상 모듈은 보호 경로 안에서만 가져온다 |

기준 문서가 원칙보다 구체적이면 기준 문서를 따른다.

## 2. 설정

`.lanekeeper/config.json` 의 `code_standards` 에 둔다. 키별 기본값은 [설정](03-configuration.md)에 있다.

| 키 | 뜻 |
|---|---|
| `project.code_standards.doc` | 기준 문서의 경로와 앵커. 값이 있으면 지시서와 경고에 이 위치가 들어간다 |
| `project.code_standards.checks` | 기준을 기계로 검사하는 명령 목록. 게이트 종류 `code-standards` 로 돌린다 |
| `project.code_standards.helpers` | 오류 기록 도우미 이름. 지시서와 경고 문구에 들어간다 |
| `project.code_standards.protected_paths` | 보호 대상 모듈을 가져와도 되는 경로(glob) |
| `project.code_standards.exempt_paths` | 경고 훅이 건너뛰는 경로(glob). 표준 출력이 본업인 명령줄 도구가 예다 |
| `project.code_standards.warn_hook` | `true` 면 새로 쓰는 코드에 대해 경고 훅이 동작한다 |

```json
"code_standards": {
  "doc": "CONTRIBUTING.md#code-standards",
  "checks": ["npm run -s lint:structure", "npm run -s typecheck"],
  "helpers": ["ignoreError", "warnError"],
  "protected_paths": ["server/src/billing/**"],
  "exempt_paths": ["cli/**"],
  "warn_hook": true
}
```

전체 예는 플러그인의 `examples/code-standards-config.json` 에 있다. 설정값은 `lanekeeper-config get project.code_standards` 로 확인한다.

## 3. 적용되는 곳

**지시서.** `lanekeeper-style brief impl` 과 `lanekeeper-style brief fix` 는 `doc` 이 있으면 범위 절에 다음 줄을 넣는다. `/lanekeeper:review-lane` 이 만드는 되돌림 지시서에도 같은 줄이 들어간다. `doc` 이 없으면 줄을 넣지 않는다.

```
- 코드 작성 기준: `CONTRIBUTING.md#code-standards` 의 코드 작성 기준을 따른다(어기면 미완료). 무시해도 되는 오류는 기록 도우미(ignoreError, warnError)로 남긴다. 보호 대상 모듈은 보호 경로(server/src/billing/**) 안에서만 가져온다.
```

**게이트.** `checks` 가 있으면 품질 종류 `code-standards`(분류 gate)가 생긴다. 명령 하나가 단계 하나이고, 앞 단계가 실패해도 모든 단계를 돌린다. `lanekeeper-quality run code-standards` 나 `lanekeeper-quality run --category gate` 로 돌린다. `quality.suites` 에 같은 이름의 스위트가 있으면 그 스위트를 쓴다.

**검수.** `/lanekeeper:review-lane` 은 9항목 검사 뒤에 게이트가 잡지 못하는 항목을 직접 확인한다. 대상은 나누기 전 특성화 테스트의 커밋, 옮긴 뒤 `-u` 사용 여부, 문구·응답·상태 코드·테스트 손잡이·순서·로그 형식의 보존, 다시 내보내기 파일, 보호 경로 밖의 보호 모듈 가져오기, 새 파일과 새 함수의 허용 폭 0 이다. 걸린 항목은 되돌림 지시서의 지적으로 보낸다.

**경고 훅.** `warn_hook` 이 `true` 면 PreToolUse 훅 `codestd/warn` 이 Write·Edit·MultiEdit 로 쓰는 코드 파일(`.js`, `.ts`, `.jsx`, `.tsx`, `.vue`, `.svelte` 와 `.mjs`, `.cjs`)을 본다. 바뀌기 전 글과 새 글을 비교해, 새로 생긴 다음 모양에만 경고를 낸다.

- 빈 catch(`catch {}`, `catch (e) {}`, 주석만 있는 catch)
- 값만 돌려주는 `.catch(() => null)`, `.catch(() => {})` 같은 꼴
- `console.`, `console[…]`, `globalThis.console`
- `catch (e) { void e }`
- `helpers` 에 있는 이름을 그대로 넘긴 `.catch(도우미)`

경고에는 도우미 이름과 기준 문서의 위치가 들어간다. 이 훅은 도구 호출을 막지 않는다. 오너가 확인할 곳을 늘리지 않기 위해서다. 테스트 파일(`*.test.*`, `*.spec.*`, `test/`, `tests/`, `__tests__/` 등)과 `exempt_paths` 는 건너뛴다.

## 4. 고려사항

- 경고 훅은 정규식으로 글자 모양만 본다. 그래서 주석이나 문자열 안의 `console.` 에도 경고가 날 수 있고, 여러 줄에 걸친 복잡한 모양은 놓칠 수 있다. 최종 판정은 `checks` 의 검사 명령이 한다.
- Bash 로 파일을 쓰는 경우(`sed`, 리다이렉션)는 경고 훅이 보지 않는다.
- 보호 대상 모듈의 이름은 설정에 두지 않는다. 기준 문서에 적고, 검수와 프로젝트 검사 명령에서 확인한다.
