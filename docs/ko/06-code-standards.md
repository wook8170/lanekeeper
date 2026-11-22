# 코드 작성 기준

여러 레인이 코드를 나누어 쓰면 레인마다 파일 크기, 오류 처리, 의존 방향을 다르게 다루기 쉽다. 그래서 프로젝트가 정한 코드 작성 기준을 레인에게 알리고, 게이트와 검수와 경고 훅에서 다시 확인하는 기능을 둔다.

Lanekeeper 는 특정 프로젝트의 기준을 담지 않는다. 일반 원칙 여섯 가지는 `/lanekeeper:code-standards` 스킬에 있다. 프로젝트별 상한, 경로, 도우미 이름, 검사 명령은 프로젝트의 기준 문서에 두고, 설정 `project.code_standards` 가 그 문서를 가리킨다. 기본값은 모두 비어 있거나 꺼져 있으므로, 설정하지 않은 저장소에서는 아무 동작도 하지 않는다. 다만 4절의 읽기 쉬운 코드 기준은 기본으로 켜져 있어 지시서와 검수에 들어간다.

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

## 4. 읽기 쉬운 코드

크기 상한은 코드가 얼마나 큰지만 막는다. 그래서 상한을 지켜도 따라가기 어려운 코드가 생긴다. 함수를 문장 순서대로 잘라 작은 조각만 많아진 코드가 그 예다. 이 절의 기준은 처음 보는 사람이 기능 하나를 쉽게 찾아 고칠 수 있는지를 본다.

설정 `project.code_standards.readability` 가 이 기준을 다룬다. 다른 키와 달리 기본으로 켜져 있다. 끄려면 `enabled` 를 `false` 로 둔다.

| 키 | 기본값 | 뜻 |
|---|---|---|
| `readability.enabled` | `true` | `false` 면 지시서 줄, 검수 항목, 경고 훅의 가독성 경고를 모두 뺀다 |
| `readability.doc` | `""` | 프로젝트가 따로 둔 가독성 기준 문서의 경로와 앵커. 값이 있으면 지시서와 경고에 이 위치가 들어간다 |
| `readability.max_params` | `7` | 매개변수 수와 입력 객체 하나의 칸 수 상한 |
| `readability.max_props` | `12` | 화면 컴포넌트(React 함수 컴포넌트, Vue `defineProps`)의 props 수 상한 |
| `readability.review_tasks` | `3` | 완료 점검에 쓰는 과제 수의 상한(1 ~ 이 값) |
| `readability.fresh_eyes_review` | `true` | 큰 변경의 완료 점검을 다른 맥락의 적대 점검으로 받는다 |

### 일곱 가지 기준

1. **판정과 실행을 나눈다.** 「해도 되나 · 무엇을 할까」를 정하는 규칙은 결과(허용 · 거절 · 확인 필요 · 적용할 변경)를 돌려주는 순수 함수로 둔다. 처리 함수에는 「읽기 → 판정 받기 → 결과대로 하기」만 남긴다. 상태 초기화 같은 정리 동작은 한 곳에서 한 번만 한다.
2. **기능 단위로 나눈다.** 파일, 훅, 컴포넌트는 사용자가 보는 기능이나 도메인 개념 단위로 나눈다. 원래 함수를 문장 순서대로 잘라 `part2` 같은 조각을 만들지 않는다. 값을 많이 담은 공용 묶음(`ctx`, `deps`)을 조각끼리 주고받지 않는다. 매개변수나 입력 객체의 칸이 `max_params` 를 넘으면 경계를 잘못 잡은 것이다. 화면 컴포넌트는 표시 옵션과 이벤트 props 가 함께 붙으므로 props 를 `max_props` 까지 둔다.
3. **같은 규칙은 한 곳에 둔다.** 두 프레임워크나 서버와 화면처럼 여러 곳에 필요한 규칙은 공용 모듈의 순수 함수 한 벌로 둔다. 두 벌을 유지해야 하는 코드는 같은 이름과 같은 경계로 나눈다.
4. **이름.** 한 글자나 약어 이름을 쓰지 않는다. 불리언은 `is`, `has`, `can`, `should` 로 시작하고, 함수는 동사로 시작한다. 같은 개념은 저장소 전체에서 한 이름으로 부른다.
5. **주석.** 무엇과 왜를 쓴다. 버전 번호, 티켓, 작업 번호, 설계 문서의 줄 번호 같은 이력은 git 기록과 설계 문서에 둔다. 근거 문서는 절 이름으로 가리킨다. 새 파일에는 머리 주석 3줄(이 파일이 맡는 일 · 부르는 곳 · 먼저 읽을 파일)을 둔다.
6. **읽는 길.** 도메인 폴더마다 `README.md` 한 쪽을 둔다. 여기서 무엇을 하는지, 요청이 어디로 들어와 어떤 순서로 거치는지, 먼저 읽을 파일이 무엇인지를 적는다.
7. **처음 보는 사람 기준으로 점검한다.** 변경을 마치면 그 영역을 처음 보는 사람이 받을 과제 1 ~ `review_tasks` 개를 정한다. 고칠 곳을 파일 3개, 300줄 안에서 찾고 같은 규칙을 두 곳에서 고치지 않아야 통과다. 통과하지 못하면 같은 변경 안에서 경계를 다시 잡는다.

### 예: 판정 함수 나누기

나누기 전에는 처리 함수 하나가 규칙을 판정하면서 상태도 바꾼다. 그래서 「잠긴 셸프에 놓을 때 문구를 바꿔라」라는 과제를 받으면 140줄을 처음부터 읽어야 한다. 정리 동작도 `return` 앞마다 되풀이된다.

```js
function onShelfDrop(field, shelf, state) {
  if (field.kind === 'json' && field.nested) { state.dragging = null; toast('중첩 JSON 은 놓을 수 없습니다'); return }
  if (shelf.locked) { state.dragging = null; toast('잠긴 셸프입니다'); return }
  if (shelf.accepts !== field.kind) { state.dragging = null; toast('이 셸프에 맞지 않는 필드입니다'); return }
  // … 규모 확인과 적용이 100줄 넘게 이어진다
  state.dragging = null
}
```

나눈 뒤에는 규칙마다 순수 함수가 하나씩 있고, 판정 함수가 이를 차례로 부른다. 처리 함수에는 읽기, 판정 받기, 결과대로 하기만 남는다. 문구를 바꾸는 과제는 `rejectLockedShelf` 한 곳과 그 테스트 몇 줄만 고치면 된다.

```js
// 셸프에 필드를 놓을 수 있는지 판정한다. 화면은 결과대로 하기만 한다.
const rejectNestedJson = (field) => (field.kind === 'json' && field.nested ? reject('중첩 JSON 은 놓을 수 없습니다') : null)
const rejectLockedShelf = (shelf) => (shelf.locked ? reject('잠긴 셸프입니다') : null)
const rejectWrongFieldKind = (field, shelf) => (shelf.accepts !== field.kind ? reject('이 셸프에 맞지 않는 필드입니다') : null)

export function judgeShelfDrop(field, shelf) {
  return rejectNestedJson(field) ?? rejectLockedShelf(shelf) ?? rejectWrongFieldKind(field, shelf) ?? checkScale(field, shelf) ?? planApply(field, shelf)
}

function onShelfDrop(field, shelf, state) {
  const verdict = judgeShelfDrop(field, shelf)
  if (verdict.kind === 'reject') toast(verdict.message)
  else if (verdict.kind === 'apply') applyPlan(state, verdict.plan)
  state.dragging = null
}
```

### 적용되는 곳

- **지시서.** `lanekeeper-style brief impl|fix` 와 되돌림 지시서의 범위 절에 「읽기 쉬운 코드」 줄과 일곱 가지 기준 요약이 들어간다. `max_params`, `max_props`, `review_tasks`, `doc` 값이 문구에 들어간다. `enabled` 가 `false` 면 줄을 넣지 않는다.
- **검수.** `/lanekeeper:review-lane` 이 「처음 보는 사람」 점검(과제 1 ~ `review_tasks` 개, 파일 3개 · 300줄 이하, 같은 규칙을 두 곳에서 고치지 않음)과 기계적 나누기의 징후(위치나 순서를 딴 이름, `ctx` · `deps` 같은 공용 묶음, `max_params` 를 넘는 입력, `max_props` 를 넘는 컴포넌트 props)를 확인한다. `fresh_eyes_review` 가 켜져 있으면 나누기, 옮기기, 리팩토링이나 큰 변경의 점검을 `lanekeeper:design-adversary` 에이전트에게 다른 맥락에서 맡긴다.
- **경고 훅.** `warn_hook` 이 켜진 프로젝트에서만 동작한다. 새로 쓰는 코드에 다음이 생기면 경고 한 줄을 더하고, 도구 호출은 막지 않는다.
  - 주석 안의 이력 표식: `1.8.7 —` 같은 버전, `F-22` 같은 티켓, `B5:` 같은 작업 번호, `L2390` · `#L120` 같은 설계 문서 줄 번호, `(#816)` 같은 PR 번호
  - 다섯 줄 이상인 새 파일의 머리 주석 누락(`.vue`, `.svelte` 는 script 블록 맨 위의 주석도 인정한다. `.d.ts` 는 건너뛴다)
  - 매개변수가 `max_params` 를 넘는 함수 선언, 또는 칸이 `max_params` 를 넘는 구조 분해 입력 객체 하나를 받는 함수
  - props 가 `max_props` 를 넘는 화면 컴포넌트. React 함수 컴포넌트(이름이 대문자로 시작하고 JSX 를 돌려주는 함수, `memo` · `forwardRef` 포함)의 구조 분해 props 와 Vue `defineProps`(타입 리터럴, 같은 파일의 interface · type, 실행 시 객체, 이름 배열)를 센다

오탐을 줄이려고 패턴을 좁게 잡았다. 문자열 안의 글자, `node 18.0.0` 처럼 구분 기호가 붙지 않은 버전, `UTF-8` · `ISO-8601` · `SHA-256` 같은 규격 이름, `A1:B2` 같은 범위, 함수 호출과 조건문, 함수 타입 표기(`cb: (a, b) => void`)는 잡지 않는다. 판정과 실행의 분리, 기능 단위 나누기, 이름의 뜻은 자동으로 재기 어려워서 검수와 7번 점검에서 본다.

## 5. 고려사항

- 경고 훅은 정규식으로 글자 모양만 본다. 그래서 주석이나 문자열 안의 `console.` 에도 경고가 날 수 있고, 여러 줄에 걸친 복잡한 모양은 놓칠 수 있다. 최종 판정은 `checks` 의 검사 명령이 한다.
- Bash 로 파일을 쓰는 경우(`sed`, 리다이렉션)는 경고 훅이 보지 않는다.
- 보호 대상 모듈의 이름은 설정에 두지 않는다. 기준 문서에 적고, 검수와 프로젝트 검사 명령에서 확인한다.
