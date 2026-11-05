# Findings report and result counts

The checker writes `findings.md` in the report language (`personal.language`). Headings and column names below are the English form; use the same columns in Korean.

## findings.md

```markdown
# <area> — adversarial UX check · <version> · <commit>

Counts: blocker <n> · high <n> · medium <n> · low <n> · axis ① <n> ② <n> ③ <n> ④ <n> ⑤ <n> ⑥ <n> ⑦ <n> ⑧ <n> ⑨ <n> · parity <n>
Personas: <persona (role, experience)> · <persona> — scenarios <n>
Checked: <journeys> journeys × <edge states> edge states = <cells> cells, not checked <n> (listed at the end)

## Findings

| No. | Screen | Severity | Axis | What the user goes through | Fix proposal | Kind | Status | Captures |
|---|---|---|---|---|---|---|---|---|
| F-01 | <screen or route> | blocker | ②④ | After saving, the list still shows the old count, so the user saves again and gets a duplicate. | Refresh the list from the save response; select the new row (<token or component>) | defect fix | open | caps/now-01.png · caps/fix-01.png |

## F-01 <short title>

- What the user goes through: <one sentence, the user's words>
- Reproduce: 1. … 2. … 3. …
- Evidence:
  - capture now: caps/now-01.png (<theme>, <width>)
  - data check: screen shows <value>; <test database query or API call> returns <value>
  - persona and screen note: <persona> understood <…>, was about to <…>
  - measurement (axis ⑨): <element> <property> = <measured> (expected <token or value>)
- Cause (when known): <file or component, without editing it>
- Fix proposal: <what changes, with the design system's token, class or component names>
- Fix capture: caps/fix-01.png, injected code inject/01.js
- Kind: defect fix | design change; conflicts with recorded decision <id>: yes | no
- Parity: same in <other implementation> | differs: <how>

## Journeys

| Persona | Journey (task scenario) | Steps | Done | Edge states checked | Findings |
|---|---|---|---|---|---|

## Axes

| Axis | Findings | Covered by |
|---|---|---|
| ① logic errors | F-03 · or "checked, no finding" | <scenarios> |

## Parity findings

## Not checked

| Cell (journey × edge state) | Why |
|---|---|
```

Severity: blocker · high · medium · low (definitions in the skill). Axis: ① to ⑨ (① logic errors ② information consistency ③ user context ④ flow context ⑤ first-time user getting lost ⑥ the next action ⑦ way out of errors and exceptions ⑧ accessibility, narrow width, dark theme ⑨ design system visual comparison), more than one when a finding sits on several. Every axis has a line in the axes table, with "checked, no finding" when it has none. Status: `open` (found, owner has not decided) · `confirmed` (owner wants it fixed) · `fixed` (fix merged and checked again by a fresh checker) · `declined` (owner decided not to fix; keep the reason).

## counts.json (for `lanekeeper-quality record ux-adversarial --from`)

One test = one cell of the check matrix (journey × edge state, or screen × edge state for a screen-by-screen check).

| Field | Meaning |
|---|---|
| `total` | cells planned |
| `passed` | cells checked without an open blocker or high finding |
| `failed` | cells with at least one open blocker or high finding (status `open` or `confirmed`) |
| `skipped` | cells planned but not checked (the "not checked" table) |
| `fixme`, `flaky` | 0 |

The verdict is `failed` while `failed > 0`. The ship precheck compares each result with the previous passed one: fewer cells or more unchecked cells is a weakening, so keep the matrix at least as wide as last time.

```json
{
  "counts": { "total": 40, "passed": 38, "failed": 2, "skipped": 0, "fixme": 0, "flaky": 0 },
  "failures": [
    { "suite": "blocker", "name": "F-01 save count", "message": "after saving, the list still shows the old count; the user saves twice" }
  ],
  "detail": {
    "base": "<commit>",
    "checker": { "agent": "lanekeeper:ux-adversary", "model": "<model>" },
    "bySeverity": { "blocker": 2, "high": 3, "medium": 5, "low": 4 },
    "byAxis": { "1": 1, "2": 2, "3": 1, "4": 2, "5": 2, "6": 1, "7": 1, "8": 1, "9": 3 },
    "findings": [
      { "id": "F-01", "screen": "<screen>", "severity": "blocker", "axis": [2, 4], "kind": "defect fix", "status": "open", "parity": "same" }
    ],
    "report": "<path of findings.md>"
  }
}
```
