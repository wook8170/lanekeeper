<!-- wb-brief v1 type=impl-multi lane={{lane}} template=impl -->
<!-- Marker: type is the routing task type (wb-route tasks), lane is the lane name. Every {{…}} placeholder must be filled before dispatch. -->
# {{lane}} — {{title}}

## Base
- Worktree: {{worktree}} (branch {{branch}})
- Base HEAD: {{base_sha}} — the integration branch HEAD right before dispatch. Check it with `git log -1` first and report before working if it differs.
- Read first: {{read_first}}

## Goal
{{goal}}

## Scope
- Owned files (do not change anything else): {{owned_files}}
- Acceptance criteria:
  1. {{acceptance}}
- When user-visible behavior changes, update the user docs and help in the same change.

## Do not
- Change files outside the owned list. Add features or refactor beyond the scope.
- Using the owner's or production servers and databases. Use the test database and the lane ports only.
- Killing processes on protected ports or killing processes by name pattern. Kill only PIDs you started.
- Browsers that open a window. Run browsers headless only.
- Do not run the full test suite, typecheck of every package or the gate (main runs them once after integration).

## Test rules
- Update the unit tests of the changed feature in the same change: normal, boundary and error paths for additions; updated expectations and a regression test for changes; remove tests of deleted features.
- When a user journey appears or changes, update the end-to-end scenario as well.
- Run only the test files you created or changed, plus one typecheck of the touched package. Do not run the full suite.
- If you find a defect you cannot fix in this lane, do not weaken the test; mark it pending and record the defect.

## Report location
- Write to {{report_path}} and return the same text as your final answer. Add an interim note after each major item so nothing is lost if the run stops.
- Include: per acceptance criterion done / partial / not done with the reason, files changed, tests run with results, open questions, new HEAD.
- Write the test result on one line such as `tests: 12 passed / 0 failed` (review item 8 reads the counts from it). Record the failure before the fix separately, such as `failed before the fix: 1`.
- Writing style: {{style}}

## Commit rules
- Commit only to your own lane branch ({{branch}}), in logical units. No push, no merge, no commits to other branches.
- End each commit message with the trailer: {{trailer}}
