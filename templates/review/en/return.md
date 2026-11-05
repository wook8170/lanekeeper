<!-- lanekeeper-brief v1 type=impl-multi lane={{lane}} template=fix -->
<!-- Return brief: written by /lanekeeper:review-lane or /lanekeeper:integrate. Send it back to the same lane. -->
# {{lane}} return — {{title}}

## Base
- Worktree: {{worktree}} (branch {{branch}})
- Base HEAD: {{base_sha}} — the current integration branch HEAD. The lane branch must have this commit as an ancestor.

## Goal
Return a new HEAD that resolves every finding below. Make no change unrelated to the findings.

## Scope
{{findings}}

## Do not
- Do not clean up or refactor unrelated code, and do not weaken test expectations.
- Do not change the integration branch or another lane branch directly, and do not push.
- Do not open a browser window. Run browsers headless only.
- Do not run the full test suite, a typecheck of every package or the gate (the main session runs them once after integration).

## Test rules
- Run only the test files for the parts you changed. Record the failure before the fix and the pass after it in the report.

## Report location
- Update {{report_path}} and return the same text as your final answer. Give the new HEAD and the outcome of each finding.
- Style: {{style}}

## Commit rules
- Commit only to your own lane branch ({{branch}}). Do not push or merge.
- {{trailer}}
