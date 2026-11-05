<!-- lanekeeper-brief v1 type=review lane={{lane}} template=review implementer={{implementer}} role=verifier -->
<!-- Marker: type is the routing task type (lanekeeper-route tasks), lane is the lane name, role=verifier marks a verifier lane whose heavy runs stop first under high load. For an adversarial review use type=adversarial (routed away from the implementer model). Every {{…}} placeholder must be filled before dispatch. -->
# {{lane}} — {{title}}

## Base
- Worktree: {{worktree}} (branch {{branch}})
- Base HEAD: {{base_sha}} — the integration branch HEAD right before dispatch. Check it with `git log -1` first and report before working if it differs.
- Read first: {{read_first}}

## Goal
Judge whether the output of lane {{target}} meets its acceptance criteria. The verdict is pass or fail.

## Scope
- Verdict table (acceptance criteria): {{criteria}}
- Method: read the code, run the unit tests of the changed files, take headless screen captures when needed.
- Criteria that ask for "full suite green" are covered by main's integration run; write "delegated to integration".
- If the review uses the same model as the implementer, state in the report that it ran in a fresh context.

## Do not
- Change product code. Hand defects over in the report (reproduction, evidence, owning lane).
- Using the owner's or production servers and databases. Use the test database and the lane ports only.
- Killing processes on protected ports or killing processes by name pattern. Kill only PIDs you started.
- Browsers that open a window. Run browsers headless only.
- Do not run the full test suite, typecheck of every package or the gate (main runs them once after integration).

## Test rules
- Run only the changed test files and the related test files, one by one. Do not run the full suite.
- Signs of weakened tests (loosened expectations, skips, added retries) make the verdict fail.

## Report location
- Write to {{report_path}} and return the same text as your final answer. Add an interim note after each major item so nothing is lost if the run stops.
- Include: verdict (pass / fail), result and evidence per criterion, defect list (reproduction, owner), items delegated to integration.
- Writing style: {{style}}

## Commit rules
- Do not commit. Results go to the report file and the final answer only.
