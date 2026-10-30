<!-- wb-brief v1 type=adversarial lane={{lane}} template=ux-adversarial implementer={{implementer}} role=verifier -->
<!-- Cover: type=adversarial routes to a model other than the implementer's (Fable recommended, Opus otherwise). role=verifier marks a verifier lane, whose heavy runs stop first under high load. Every {{…}} must be filled before dispatch. -->
# {{lane}} — adversarial UX check of {{title}}

You are an adversarial UX checker who took no part in building this product. Drive the real screens and find where a first-time user gets stuck, goes wrong or loses work. No praise, no summary.

## Basis
- Version and commit: base HEAD {{base_sha}}. At start, check with `git log -1` that it matches; report before checking when it does not.
- Starting the product: {{harness}} — use only the assigned ports {{ports}}. Never protected ports or the owner's database.
- Design system of record: {{design_system}}
- Recorded design decisions: {{design_decisions}}
- Other front-end implementation: {{parity_target}}
- Read first: {{read_first}}

## Goal
Take 3 to 5 core journeys of {{target}} to the end as a first-time user and report findings on five axes (① data correctness ② location and way back ③ what to do on this screen ④ flow continuity ⑤ visual consistency). Axis ⑤ has the same weight as ① to ④ and goes into the findings table like any other.

## Scope
- At each step of a journey: does the user know what to press, what happened, how to undo a mistake, and does an error say the cause and the fix?
- Create edge states on purpose: light and dark, wide ({{wide}}) and narrow ({{narrow}}) width, keyboard only, no permission ({{roles}}), empty state, very long names, a lot of data, leaving before saving, double clicks, back, reload and deep links.
- Each finding in this order: what the user goes through (one sentence) → steps to reproduce → evidence (a capture now, plus a check against the real data or measured computed style or pixels) → severity (blocker, high, medium, low) → axis → fix proposal (by the design system's token, class and component names) → fix capture (DOM or CSS injected into the same page instead of product code, injected code attached).
- Axis ①: query the real value from the test database or the API and write it next to the value on screen.
- Axis ⑤: keep the measurements (element, property, measured value, expected value or token).
- With another front-end implementation, check each finding there too and list differences as parity findings.
- Mark each finding as a defect fix (restores the intended look or behaviour) or a design change (owner's decision); say when a proposal conflicts with a recorded design decision.
- Create test data inside the isolated environment that runs the product, and clean it up at the end.

## Do not
- Edit product code, settings or tests, or commit. You write only to the result folder {{result_dir}}.
- Open a browser with a window. Headless only. Capture at 2x (deviceScaleFactor 2) and drop Playwright's default `--hide-scrollbars` (ignoreDefaultArgs).
- Use the owner's or production servers and databases, or protected ports. Stop processes by name (pkill, killall). Stop only the PIDs you started and confirm the ports are closed.
- Make look-alike mockups. Proposals and fix captures use only the tokens and classes of the design system of record.
- Leave customer data, personal names or mail addresses in findings or captures.

## Test rules
- Do not run the full test suite, a typecheck of every package or the gate (the main session runs them once after merging).
- Run browser steps through `wb-slot --kind browser -- …`; the slot waits while the load is high.

## Report location
- Write the findings table, the journey notes, parity findings and measurements to {{result_dir}}/findings.md, captures to {{result_dir}}/caps/ as `now-<n>.png` and `fix-<n>.png` (n = finding number), injected code to {{result_dir}}/inject/<n>.js. Return the same content as your final answer.
- Write the counts JSON for the result record to {{result_dir}}/counts.json (checked items and open blocker findings).
- Save an interim note after each large journey so the result survives an interruption.
- Return five lines: findings by severity and axis · the three largest · report path · capture path · what was not checked.
- Style: {{style}}

## Commit rules
- Do not commit. Results stay in the result folder and the final answer.
