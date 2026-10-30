---
name: quality-usability
description: Run a usability test of the product with beginner stand-in agents (scenarios, task completion, wrong turns, blockers) plus any automated part configured in project.quality.suites (category usability), judge it against fixed pass criteria and record it as a common head JSON and a workbook in the results index. Use when the user runs /wb:quality-usability, asks for a usability or first-time-user test with recorded results, or when /wb:ship-verify reports usability as missing, stale or manual.
---

# wb quality-usability

This skill asks whether a beginner can finish the main tasks. Where the product misleads, strands or loses a user around journeys that work, and whether it looks the same everywhere, is `/wb:quality-ux-adversarial` (an adversarial checker in a separate context, no product code changes, owner confirms fixes). Before a release with a user interface, run this one first, then that one.

A usability result has two parts. The automated part (for example a script that drives the main journeys headless and counts the steps) is a suite command and runs like any other kind. The agent part needs a judgement, so this skill runs it and records the result with `wb-quality record`.

## Steps

1. `wb-quality list`: find the suites with category `usability`. A suite with a command: run it with `wb-quality run <kind>` and go on with step 6 when the suite covers the whole test. A suite without a command is recorded in steps 2 to 5.
2. Scenarios: take them from the project's scenario list (a usability or e2e ledger, or the user manual's main tasks). Each scenario has a goal in the user's words, the expected number of steps, and a priority (P0 = core journey).
3. Run each scenario with a beginner stand-in: dispatch a subagent with a brief (the dispatch guard checks it) that plays a first-time user, gets only the goal and the running product (headless browser), and reports for each scenario: done or not, steps taken, wrong turns, where it looked for help, and blockers with a capture. The stand-in does not read the source code.
4. Judge each scenario with these criteria:

   | Result | When |
   |---|---|
   | passed | the goal was reached, no blocker, steps taken at most 1.5 × the expected steps |
   | failed | the goal was not reached, or a blocker (a dead end, an error, data loss, a missing control), or more than 1.5 × the expected steps |

   The verdict is passed only when every P0 scenario passed and no scenario has a blocker.
5. Write the counts to a JSON file in the scratch folder and record it:

   ```json
   { "counts": { "total": 12, "passed": 11, "failed": 1, "skipped": 0, "fixme": 0, "flaky": 0 },
     "failures": [{ "suite": "P0", "name": "Share a chart", "message": "no share button on the chart page" }],
     "detail": { "criteria": "goal reached, no blocker, steps ≤ 1.5 × expected", "scenarios": [] } }
   ```

   `wb-quality record <kind> --verdict passed|failed --from <file>`
6. Failed scenarios: fix the product, not the scenario. Run the failed scenarios again, then the whole set once before recording a pass. Commit the result files and the index.

## Do not

- Do not drop a scenario, raise the step allowance or mark a scenario fixme to get a pass. The ship precheck blocks fewer scenarios and more skipped or fixme ones.
- Do not open a browser with a window. Stand-ins drive a headless browser.
- Do not put customer data, personal names or mail addresses in the scenarios or the result.
