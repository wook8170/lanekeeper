# Review format and reconciliation table

The reviewer writes `review-rev<N>.md` in the report language (`personal.language`). Headings and column names below are the English form; use the same columns in Korean.

## review-rev<N>.md

```markdown
# <design title> — adversarial <design|implementation> review · rev <N> · <commit>

Scope: full | high findings of rev <N-1> plus new risks of rev <N>
Checked against the code: <n> cited places, not checkable <n> (listed at the end)

## Findings

| No. | Severity | What is wrong | Evidence | Direction of the fix |
|---|---|---|---|---|
| D-01 | high | The design keeps the old row count, but the cited query already drops deleted rows, so the totals differ. | design.md:42 · src/report/count.ts:118 | Count from the same query; state the rule in the design |

## Owner decisions

| No. | Question | Options | Why the design cannot decide it |
|---|---|---|---|

## Invariants (implementation review)

| Invariant (design paragraph) | Where it holds or breaks (path:line) | Holds |
|---|---|---|

## New risks of this revision

## Not checkable

| Claim | Why |
|---|---|

high <N>
```

Severity: high · medium · low (definitions in the skill). The last line is always `high <N>`, the open high findings of this revision.

## Reconciliation table (in the design, one per revision)

The author adds this table to the design at every revision and marks each changed paragraph with `[rev <N>]`.

```markdown
## Reconciliation rev <N>

| Finding | Severity | Decision | Applied at | Reason (when not accepted) |
|---|---|---|---|---|
| D-01 | high | accepted | §3.2 [rev 2] | |
| D-04 | medium | not accepted | — | the cited path is test-only (tests/fx.ts:12); production uses src/count.ts:40, already covered |
```
