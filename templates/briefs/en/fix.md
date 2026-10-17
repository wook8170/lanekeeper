<!-- wb-brief v1 type=impl-multi lane={{lane}} template=fix -->
<!-- Marker: type is the routing task type (wb-route tasks), lane is the lane name. Every {{…}} placeholder must be filled before dispatch. -->
# {{lane}} — {{title}}

## Base
- Worktree: {{worktree}} (branch {{branch}})
- Base HEAD: {{base_sha}} — the integration branch HEAD right before dispatch. Check it with `git log -1` first and report before working if it differs.
- Read first: {{read_first}}

## Goal
Fix {{defect}}. Work in order: reproduce, confirm the cause, fix, regression test. Do not change code before the cause is confirmed.

## Scope
- Symptom and reproduction: {{repro}}
- Owned files (do not change anything else): {{owned_files}}
- Done when the symptom is gone in the reproduction and a regression test that failed on the old code passes.

## Do not
- Clean up or refactor code unrelated to the cause. Hide the symptom (swallowing errors, loosening test expectations).
- Using the owner's or production servers and databases. Use the test database and the lane ports only.
- Killing processes on protected ports or killing processes by name pattern. Kill only PIDs you started.
- Browsers that open a window. Run browsers headless only.
- Do not run the full test suite, typecheck of every package or the gate (main runs them once after integration).

## Test rules
- Write the regression test first and confirm it fails on the old code before fixing.
- Run only the test files you created or changed, plus one typecheck of the touched package. Do not run the full suite.
- If the same cause can surface elsewhere, do not fix it; list it in the report.

## Report location
- Write to {{report_path}} and return the same text as your final answer. Add an interim note after each major item so nothing is lost if the run stops.
- Include: the cause (file and line), the fix, the regression test with before/after results, files changed, remaining risk, new HEAD.
- Write the test result on one line such as `tests: 12 passed / 0 failed` (review item 8 reads the counts from it). Record the failure before the fix separately, such as `failed before the fix: 1`.
- Writing style: {{style}}

## Commit rules
- Commit only to your own lane branch ({{branch}}), in logical units. No push, no merge, no commits to other branches.
- End each commit message with the trailer: {{trailer}}
