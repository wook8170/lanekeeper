<!-- lanekeeper-brief v1 type=impl-spec lane={{lane}} template=test -->
<!-- Marker: type is the routing task type (lanekeeper-route tasks), lane is the lane name. Every {{…}} placeholder must be filled before dispatch. -->
# {{lane}} — {{title}}

## Base
- Worktree: {{worktree}} (branch {{branch}})
- Base HEAD: {{base_sha}} — the integration branch HEAD right before dispatch. Check it with `git log -1` first and report before working if it differs.
- Read first: {{read_first}}

## Goal
{{test_goal}}

## Scope
- Features and scenarios: {{scenarios}}
- Unit tests cover normal, boundary and error paths; end-to-end tests cover the normal journey, permission denial and a typical error.
- If the project keeps a test case ledger, update it in the same change. Never reuse case IDs.

## Do not
- Retries, fixed sleeps, structure-bound selectors (use role and name based selectors).
- Leaving test data in shared databases. Create and clean it up inside the test.
- Using the owner's or production servers and databases. Use the test database and the lane ports only.
- Killing processes on protected ports or killing processes by name pattern. Kill only PIDs you started.
- Browsers that open a window. Run browsers headless only.
- Do not run the full test suite, typecheck of every package or the gate (main runs them once after integration).

## Test rules
- Run only the test files you created or changed. Do not run the full suite.
- A new test counts as done after two consecutive passes.
- If you find a defect, do not weaken the test; mark it pending and record the defect.

## Report location
- Write to {{report_path}} and return the same text as your final answer. Add an interim note after each major item so nothing is lost if the run stops.
- Include: tests added or changed, results of the two solo runs, defects found and pending marks, ledger updates, new HEAD.
- Write the test result on one line such as `tests: 12 passed / 0 failed` (review item 8 reads the counts from it). Record the failure before the fix separately, such as `failed before the fix: 1`.
- Writing style: {{style}}

## Commit rules
- Commit only to your own lane branch ({{branch}}), in logical units. No push, no merge, no commits to other branches.
- End each commit message with the trailer: {{trailer}}
