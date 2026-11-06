---
name: ship-verify
description: Ship verification with a precheck gate. First every required verification (project.quality.ship.requires — unit, integration, gate, e2e, UI stability, usability; ux-adversarial only warns unless it is required) must have a passed result on the current commit that is not weaker than the previous passed one; missing, stale or failed kinds are run automatically and failures are fixed and run again until they pass. Then the screens the version changed get an adversarial UX check with a design system visual comparison (an open blocker or high finding blocks), and only then the production readiness verification starts and its verdict is recorded. Use when the user runs /lanekeeper:ship-verify, asks whether a release can ship, asks for a go/no-go, or before starting verifying-production-readiness or a readiness-auditor.
---

# Lanekeeper ship-verify

The ship gate hook blocks the readiness verification (the skills in `quality.ship.skills`, the agents in `quality.ship.agents`) until `lanekeeper-quality precheck` passes. This skill is the way through it.

## Steps

1. Commit everything. The precheck needs a clean tree (result files may stay uncommitted).
2. Run `lanekeeper-quality precheck --run`. It reads the newest result of each required kind from the index and decides:

   | State | Meaning | What happens |
   |---|---|---|
   | ok | passed on this commit (or later commits only touched result files or paths outside the suite's `stale_paths`) | nothing |
   | missing | no result | runs the suite |
   | stale | result of another commit, or ran with uncommitted changes | runs the suite |
   | failed | the newest result did not pass | runs the suite again |
   | weakened | fewer tests, more skipped or fixme tests, or a loosened threshold than the previous passed result | blocked; running again does not help |
   | manual | the kind has no command | run its quality skill, then record it |

3. Exit 0: go to step 6.
4. Exit 1, failed kinds: read `failures` in the result JSON and the log, find the cause, and fix it. Code fixes go to a lane with a brief (the dispatch guard checks the brief, the model and the lane cap); the lane runs only the tests it touched. After the fix is merged, run `lanekeeper-quality run <kind>` here. Repeat 2 to 4 until the precheck passes. Never weaken, skip or fixme a test, and never loosen a threshold, to get through.
5. Exit 1, weakened kinds: tell the user what changed (the precheck line names the numbers and the baseline commit). Either revert the change, or, when it was intended (tests moved elsewhere, a threshold corrected), the repository owner types `/lanekeeper:approve accept-quality <kind> --reason <why>` in the prompt. Agents cannot do this. Manual kinds: run their quality skill (`/lanekeeper:quality-usability`).
   Warning kinds (`quality.ship.advisory`, default `ux-adversarial`) are listed under the table and do not change the exit code. A warning that says ux-adversarial is missing or failed means the adversarial UX check was not done, or a blocker or high finding is still open: step 6 handles it.
6. Changed screens. When the version changed any screen, run `/lanekeeper:quality-ux-adversarial` on the changed screens ("Before a ship: the changed screens" in that skill): a checker from a different context than the implementer, the product started in isolation, personas chosen first and their real task scenarios done end to end through each changed flow, headless with 2x captures, one line per screen on what the persona understood and is about to do, and all nine required axes: logic errors, information consistency, user context, flow context, a first-time user getting lost, the next action, a way out of errors and exceptions, accessibility with narrow width and dark theme, and the design system visual comparison (touching spacing, tight line height, mixed type size or weight, table row height, button and badge size). The gate, the lane tests and the design lint baseline do not catch these. Findings that change a screen are collected and confirmed by the owner before any fix. An open blocker or high finding stops here: fix the confirmed findings, check them again, record the kind again. A version with no changed screen records zero cells and says so.
7. Start the readiness verification: the `verifying-production-readiness` skill, or a readiness-auditor subagent in a fresh context. The ship gate hook now lets it through. Give it the changed-screen findings as an input; a high finding in its verdict blocks the ship as well.
8. Record the verdict: `lanekeeper-quality record ship --verdict passed|failed --report <readiness report path>`. The result keeps the precheck table of this commit.
9. Run `/lanekeeper:quality-report` for the version roll-up and commit the result files, the index and the roll-up.
10. Report to the user in a form they can open remotely (an artifact): the precheck table, the findings table of the changed-screen check with captures, the readiness verdict, and the screen changes waiting for the owner's confirmation.

## Contract with /lanekeeper:report

- Numbers come from `lanekeeper-quality status --json` and `lanekeeper-quality report --json`. Quote them; do not recount.
- A no-go is reported as no-go. "Implemented", "merged" and "released" are different states; say which one is true.
