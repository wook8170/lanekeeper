---
name: ship-verify
description: Ship verification with a precheck gate. First every required verification (project.quality.ship.requires — unit, integration, gate, e2e, UI stability, usability; ux-adversarial only warns unless it is required) must have a passed result on the current commit that is not weaker than the previous passed one; missing, stale or failed kinds are run automatically and failures are fixed and run again until they pass. Only then the production readiness verification starts and its verdict is recorded. Use when the user runs /wb:ship-verify, asks whether a release can ship, asks for a go/no-go, or before starting verifying-production-readiness or a readiness-auditor.
---

# wb ship-verify

The ship gate hook blocks the readiness verification (the skills in `quality.ship.skills`, the agents in `quality.ship.agents`) until `wb-quality precheck` passes. This skill is the way through it.

## Steps

1. Commit everything. The precheck needs a clean tree (result files may stay uncommitted).
2. Run `wb-quality precheck --run`. It reads the newest result of each required kind from the index and decides:

   | State | Meaning | What happens |
   |---|---|---|
   | ok | passed on this commit (or later commits only touched result files or paths outside the suite's `stale_paths`) | nothing |
   | missing | no result | runs the suite |
   | stale | result of another commit, or ran with uncommitted changes | runs the suite |
   | failed | the newest result did not pass | runs the suite again |
   | weakened | fewer tests, more skipped or fixme tests, or a loosened threshold than the previous passed result | blocked; running again does not help |
   | manual | the kind has no command | run its quality skill, then record it |

3. Exit 0: go to step 6.
4. Exit 1, failed kinds: read `failures` in the result JSON and the log, find the cause, and fix it. Code fixes go to a lane with a brief (the dispatch guard checks the brief, the model and the lane cap); the lane runs only the tests it touched. After the fix is merged, run `wb-quality run <kind>` here. Repeat 2 to 4 until the precheck passes. Never weaken, skip or fixme a test, and never loosen a threshold, to get through.
5. Exit 1, weakened kinds: tell the user what changed (the precheck line names the numbers and the baseline commit). Either revert the change, or, when it was intended (tests moved elsewhere, a threshold corrected), the repository owner runs `wb-quality accept <kind> --reason "<why>"` in their own terminal. Agents cannot run it. Manual kinds: run their quality skill (`/wb:quality-usability`).
   Warning kinds (`quality.ship.advisory`, default `ux-adversarial`) are listed under the table and do not change the exit code. A warning that says ux-adversarial is missing or failed means the adversarial UX check was not done, or a blocker finding is still open: tell the user, and run `/wb:quality-ux-adversarial` when they want it before shipping.
6. Start the readiness verification: the `verifying-production-readiness` skill, or a readiness-auditor subagent in a fresh context. The ship gate hook now lets it through.
7. Record the verdict: `wb-quality record ship --verdict passed|failed --report <readiness report path>`. The result keeps the precheck table of this commit.
8. Run `/wb:quality-report` for the version roll-up and commit the result files, the index and the roll-up.

## Contract with /wb:report

- Numbers come from `wb-quality status --json` and `wb-quality report --json`. Quote them; do not recount.
- A no-go is reported as no-go. "Implemented", "merged" and "released" are different states; say which one is true.
