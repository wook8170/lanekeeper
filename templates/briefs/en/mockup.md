<!-- lanekeeper-brief v1 type=mockup lane={{lane}} template=mockup -->
<!-- Marker: type is the routing task type (lanekeeper-route tasks), lane is the lane name. Every {{…}} placeholder must be filled before dispatch. -->
# {{lane}} — {{title}}

## Base
- Worktree: {{worktree}} (branch {{branch}})
- Base HEAD: {{base_sha}} — the integration branch HEAD right before dispatch. Check it with `git log -1` first and report before working if it differs.
- Read first: {{read_first}}

## Goal
Make a mockup of the structural change to {{screen}}. Show the current screen and alternatives A and B side by side so the owner can pick one.

## Scope
- Build the mockup with the project's real design tokens and shared component classes. No imitation colors or spacing.
- Output: mockup file {{mockup_path}}, screen captures at 2x, one paragraph of pros and cons per alternative.
- Comparison axes: {{compare_axes}}

## Do not
- Change product source. Do not implement before an alternative is chosen.
- Decorative emoji, colored stripes on card tops, thick left bars.
- Using the owner's or production servers and databases. Use the test database and the lane ports only.
- Killing processes on protected ports or killing processes by name pattern. Kill only PIDs you started.
- Browsers that open a window. Run browsers headless only.
- Do not run the full test suite, typecheck of every package or the gate (main runs them once after integration).

## Test rules
- A mockup is not code under test. Instead capture it at 2x with a headless browser and check it in light and dark themes.
- Do not run test suites. Running the full suite is not allowed.

## Report location
- Write to {{report_path}} and return the same text as your final answer. Add an interim note after each major item so nothing is lost if the run stops.
- Include: captures per alternative, pros and cons, the recommendation with reasons, questions for the owner.
- Writing style: {{style}}

## Commit rules
- Commit only to your own lane branch ({{branch}}), in logical units. No push, no merge, no commits to other branches.
- End each commit message with the trailer: {{trailer}}
