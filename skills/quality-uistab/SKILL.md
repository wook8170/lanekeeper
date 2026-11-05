---
name: quality-uistab
description: Run the project's UI stability harness (category uistab in project.quality.suites: layout, overflow and visual checks across screens) headless through the run slots, and archive the result as a common head JSON and a workbook with the threshold files it depends on, then update the results index. Use when the user runs /lanekeeper:quality-uistab, asks for UI stability results, or when /lanekeeper:ship-verify needs a fresh UI stability result.
---

# Lanekeeper quality-uistab

List the harness threshold files under the suite's `thresholds` (`{ "file": "…", "rule": "max" }` when a larger number is looser, `"min"` when a smaller one is). Their hashes go into the result, and the ship precheck blocks a loosened threshold.

## Steps

1. `lanekeeper-quality list` shows the configured suites. The suites of this skill are the ones with category `uistab`. None configured: show the user the `quality.suites` example in the plugin's `examples/quality-config.json` and stop.
2. Commit or set aside your changes first. A run on a tree with uncommitted changes is recorded as stale and the ship precheck will not use it.
3. Run `lanekeeper-quality run --category uistab` (or `lanekeeper-quality run <kind>` for one suite). Each suite runs its configured command through `lanekeeper-slot` (heavy suites wait for a free slot and for the load to drop). The common head JSON and the workbook go to `<results>/<version>/<date>/<kind>-<HHMM>.{json,xlsx}`, the log stays in the raw folder (not committed), and the index (`index.json`, `INDEX.md`) is rebuilt.
4. Quote the `[quality] … passed|failed · total … · passed … · failed … · skipped … · fixme …` line. Do not recount.
5. Failed: read `failures` in the JSON and the log in `raw.log`, fix the cause in the code, then run the suite again. Repeat until it passes. Implementation fixes go to a lane with a brief (the dispatch guard checks it); the lane runs only the tests it touched, and this skill runs the suite again after merging the fix.
6. Commit the JSON, the workbook, `index.json` and `INDEX.md`.

## Do not

- Do not weaken a test, add `skip`/`fixme`, lower a threshold or shorten the command to get a pass. The ship precheck compares every result with the previous passed one and blocks fewer tests, more skipped or fixme tests and loosened thresholds.
- Do not write test data into the owner's production database. Use the fixed test database the suite is configured for.
- Do not start a browser with a window. Browser suites run headless.
