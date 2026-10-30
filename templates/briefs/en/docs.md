<!-- wb-brief v1 type=docs lane={{lane}} template=docs -->
<!-- Marker: type is the routing task type (wb-route tasks), lane is the lane name. Every {{…}} placeholder must be filled before dispatch. -->
# {{lane}} — {{title}}

## Base
- Worktree: {{worktree}} (branch {{branch}})
- Base HEAD: {{base_sha}} — the integration branch HEAD right before dispatch. Check it with `git log -1` first and report before working if it differs.
- Read first: {{read_first}}

## Goal
{{doc_goal}}

## Scope
- Documents: {{doc_files}}
- Count numbers, lists and option values from the code or a command run. Do not copy values from existing documents.
- Leave values you could not confirm marked as unconfirmed.
- Keep documents that state the same facts (user docs, developer docs, backlog) in step.

## Do not
- Change product code. Leave the working process, tool names or self-assessment in the documents.
- Unsupported judgments (efficient, optimal, stable) and hype words.
- Using the owner's or production servers and databases. Use the test database and the lane ports only.
- Killing processes on protected ports or killing processes by name pattern. Kill only PIDs you started.
- Browsers that open a window. Run browsers headless only.
- Do not run the full test suite, typecheck of every package or the gate (main runs them once after integration).

## Test rules
- If the project has a docs check command, run only that check. Do not run the full suite.
- If screen captures are needed, retake them at 2x with a headless browser.

## Report location
- Write to {{report_path}} and return the same text as your final answer. Add an interim note after each major item so nothing is lost if the run stops.
- Include: documents and sections changed, newly counted values with their source, unconfirmed items, new HEAD.
- Writing style: {{style}}

## Commit rules
- Commit only to your own lane branch ({{branch}}), in logical units. No push, no merge, no commits to other branches.
- End each commit message with the trailer: {{trailer}}
