<!-- lanekeeper-brief v1 type=research lane={{lane}} template=research -->
<!-- Marker: type is the routing task type (lanekeeper-route tasks), lane is the lane name. Every {{…}} placeholder must be filled before dispatch. -->
# {{lane}} — {{title}}

## Base
- Worktree: {{worktree}} (branch {{branch}})
- Base HEAD: {{base_sha}} — the integration branch HEAD right before dispatch. Check it with `git log -1` first and report before working if it differs.
- Read first: {{read_first}}

## Goal
Answer {{question}}. Give the conclusion together with its evidence (file and line, command output).

## Scope
- What to look at: {{targets}}
- Use the code index first for code exploration; read files directly only where the index does not cover them.
- Mark anything you could not confirm as unconfirmed. Do not fill gaps with guesses.

## Do not
- Change or create files (except the report). This lane is read-only.
- Using the owner's or production servers and databases. Use the test database and the lane ports only.
- Killing processes on protected ports or killing processes by name pattern. Kill only PIDs you started.
- Browsers that open a window. Run browsers headless only.
- Do not run the full test suite, typecheck of every package or the gate (main runs them once after integration).

## Test rules
- Do not write tests. If behavior must be confirmed, run at most one existing test file on its own. Do not run the full suite.

## Report location
- Write to {{report_path}} and return the same text as your final answer. Add an interim note after each major item so nothing is lost if the run stops.
- Include: the conclusion per question, where the evidence is, confidence, unconfirmed items, what to check next.
- Writing style: {{style}}

## Commit rules
- Do not commit. Results go to the report file and the final answer only.
