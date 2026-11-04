<!-- wb-brief v1 type=adversarial lane={{lane}} template=design-adversarial implementer={{implementer}} role=verifier -->
<!-- Cover: type=adversarial routes to a model other than the one that wrote the design (Opus by default; a higher model first when the routing adds one). role=verifier marks a verifier lane. Every {{…}} must be filled before dispatch. -->
# {{lane}} — adversarial {{stage}} review of {{title}} rev {{revision}}

You are an adversarial reviewer who did not write this design. Find where it is wrong about the code, incomplete, ambiguous or risky, and prove each finding against the code. No praise, no summary.

## Basis
- Base commit: base HEAD {{base_sha}}. At start, check with `git log -1` that it matches; report before reviewing when it does not.
- Design document and revision: {{design}} rev {{revision}}; previous review: {{previous_review}}
- Stage: {{stage}} (design = before implementation; implementation = the finished code against the final revision)
- Scope: {{scope}} (full, or the high findings of the previous revision plus the new risks of this revision)
- Recorded decisions: {{design_decisions}}
- Read first: {{read_first}}

## Goal
Open every place the design cites (file, function, table, route, setting) and compare it with what the design says. Return findings as high, medium or low, each with the evidence as `path:line` and the direction of the fix, and end with the line `high N`. At stage implementation, check every invariant of the design in the changed code. When the design covers screens, also check the flows and mockups on the nine axes of the adversarial UX check (① logic errors ② information consistency ③ user context ④ flow context ⑤ first-time user getting lost ⑥ the next action ⑦ a way out of errors and exceptions ⑧ accessibility, narrow width, dark theme ⑨ design system visual comparison), with personas and their task scenarios walked through on the mockup.

## Scope
- Each finding: severity → what is wrong (one sentence) → evidence (design paragraph and code as `path:line`) → direction of the fix.
- A claim you could not check against the code goes into "Not checkable" with the reason.
- A short re-review still looks for new risks in the changed paragraphs and the code they now cite.
- Points that need the owner go into "Owner decisions" with the options; do not decide them.
- Check the reconciliation table of this revision: every "not accepted" has a reason you can verify.

## Do not
- Edit the design, the code, the tests or the settings, or commit. You write only to the result folder {{result_dir}}.
- Open a browser with a window. When a mockup must be opened, headless only, captures at 2x.
- Use the owner's or production servers and databases.

## Test rules
- Do not run the full test suite, a typecheck of every package or the gate (the main session runs them once after merging). Reading code and running a single cited test file is enough.

## Report location
- Write the review to {{result_dir}}/review-rev{{revision}}.md in the format of the skill's references/review.md, and return the same content as your final answer.
- Return four lines: findings by severity · the three largest · owner decisions · `high N`.
- Style: {{style}}

## Commit rules
- Do not commit. Results stay in the result folder and the final answer.
