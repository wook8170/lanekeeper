# Findings report and result counts

The checker writes `findings.md` in the report language (`personal.language`). Headings and column names below are the English form; use the same columns in Korean.

## findings.md

```markdown
# <area> — adversarial UX check · <version> · <commit>

Counts: blocker <n> · high <n> · medium <n> · low <n> · axis ① <n> ② <n> ③ <n> ④ <n> ⑤ <n> · parity <n>
Checked: <journeys> journeys × <edge states> edge states = <cells> cells, not checked <n> (listed at the end)

## Findings

| No. | Screen | Severity | Axis | What the user goes through | Fix proposal | Kind | Status | Captures |
|---|---|---|---|---|---|---|---|---|
| F-01 | <screen or route> | blocker | ①④ | After saving, the list still shows the old count, so the user saves again and gets a duplicate. | Refresh the list from the save response; select the new row (<token or component>) | defect fix | open | caps/now-01.png · caps/fix-01.png |

## F-01 <short title>

- What the user goes through: <one sentence, the user's words>
- Reproduce: 1. … 2. … 3. …
- Evidence:
  - capture now: caps/now-01.png (<theme>, <width>)
  - data check: screen shows <value>; <test database query or API call> returns <value>
  - measurement (axis ⑤): <element> <property> = <measured> (expected <token or value>)
- Cause (when known): <file or component, without editing it>
- Fix proposal: <what changes, with the design system's token, class or component names>
- Fix capture: caps/fix-01.png, injected code inject/01.js
- Kind: defect fix | design change; conflicts with recorded decision <id>: yes | no
- Parity: same in <other implementation> | differs: <how>

## Journeys

| Journey | Steps | Done | Edge states checked | Findings |
|---|---|---|---|---|

## Parity findings

## Not checked

| Cell (journey × edge state) | Why |
|---|---|
```

Severity: blocker · high · medium · low (definitions in the skill). Axis: ① to ⑤, two when a finding sits on both. Status: `open` (found, owner has not decided) · `confirmed` (owner wants it fixed) · `fixed` (fix merged and checked again by a fresh checker) · `declined` (owner decided not to fix; keep the reason).

## counts.json (for `wb-quality record ux-adversarial --from`)

One test = one cell of the check matrix (journey × edge state, or screen × edge state for a screen-by-screen check).

| Field | Meaning |
|---|---|
| `total` | cells planned |
| `passed` | cells checked without an open blocker finding |
| `failed` | cells with at least one open blocker finding (status `open` or `confirmed`) |
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
    "checker": { "agent": "wb:ux-adversary", "model": "<model>" },
    "bySeverity": { "blocker": 2, "high": 3, "medium": 5, "low": 4 },
    "byAxis": { "1": 3, "2": 2, "3": 4, "4": 2, "5": 6 },
    "findings": [
      { "id": "F-01", "screen": "<screen>", "severity": "blocker", "axis": [1, 4], "kind": "defect fix", "status": "open", "parity": "same" }
    ],
    "report": "<path of findings.md>"
  }
}
```
